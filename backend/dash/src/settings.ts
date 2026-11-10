import type { NewBook } from '@higalibra/scraping';

export type MatchOperator = 'and' | 'or';
export type ReservationField = 'publishers' | 'authors' | 'titleKeywords';

export interface ReservationRule {
  type: 'rule';
  id: string;
  field: ReservationField;
  join: MatchOperator;
  negate: boolean;
  values: string[];
}

export interface ReservationGroupNode {
  type: 'group';
  id: string;
  join: MatchOperator;
  children: ReservationExpressionNode[];
}

export type ReservationExpressionNode = ReservationRule | ReservationGroupNode;

export interface ReservationExpression {
  children: ReservationExpressionNode[];
}

export interface ReservationSettings {
  expression: ReservationExpression;
}

export const EMPTY_RESERVATION_SETTINGS: ReservationSettings = {
  expression: { children: [] },
};

const MAX_RULES = 60;
const MAX_GROUP_DEPTH = 3;
const MAX_VALUES_PER_RULE = 20;
const MAX_VALUE_LENGTH = 100;
export function reservationSettingsObjectKey(
  prefix: string,
  cardNo: string,
): string {
  return `${prefix}/${encodeURIComponent(cardNo)}.json`;
}

export function parseReservationSettings(value: unknown): ReservationSettings {
  if (!isRecord(value)) {
    throw new Error('Reservation settings must be a JSON object.');
  }
  return { expression: parseExpression(value.expression) };
}

export function hasActiveReservationSettings(
  settings: ReservationSettings,
): boolean {
  return hasActiveChildren(settings.expression.children);
}

export function matchesReservationSettings(
  book: Pick<NewBook, 'title' | 'author' | 'publisher'>,
  settings: ReservationSettings,
): boolean {
  if (!hasActiveReservationSettings(settings)) return false;
  return evaluateChildren(settings.expression.children, book);
}

function parseExpression(value: unknown): ReservationExpression {
  if (!isRecord(value) || !Array.isArray(value.children)) {
    throw new Error('Reservation settings expression must include children.');
  }
  const state = { ids: new Set<string>(), ruleCount: 0 };
  return {
    children: parseChildren(value.children, 0, state, 'expression'),
  };
}

function parseChildren(
  children: unknown[],
  groupDepth: number,
  state: { ids: Set<string>; ruleCount: number },
  name: string,
): ReservationExpressionNode[] {
  return children.flatMap((child, index): ReservationExpressionNode[] => {
    const childName = `${name} condition ${index + 1}`;
    if (!isRecord(child)) {
      throw new Error(`Reservation setting ${childName} must be an object.`);
    }
    if (child.type === 'rule') {
      state.ruleCount += 1;
      if (state.ruleCount > MAX_RULES) {
        throw new Error(
          `Reservation settings support at most ${MAX_RULES} conditions.`,
        );
      }
      const rule = parseRule(child, childName, state.ids);
      return rule.values.length > 0 ? [rule] : [];
    }
    if (child.type !== 'group') {
      throw new Error(`Reservation setting ${childName} has an invalid type.`);
    }
    if (groupDepth >= MAX_GROUP_DEPTH) {
      throw new Error(
        `Reservation settings support at most ${MAX_GROUP_DEPTH} nested groups.`,
      );
    }
    const id = parseId(child.id, childName, state.ids);
    const join = parseOperator(child.join, `${childName} join`);
    if (!Array.isArray(child.children)) {
      throw new Error(
        `Reservation setting ${childName} must include children.`,
      );
    }
    const nestedChildren = parseChildren(
      child.children,
      groupDepth + 1,
      state,
      childName,
    );
    return nestedChildren.length > 0
      ? [{ type: 'group', id, join, children: nestedChildren }]
      : [];
  });
}

function parseRule(
  value: Record<string, unknown>,
  name: string,
  ids: Set<string>,
): ReservationRule {
  const id = parseId(value.id, name, ids);
  if (!isReservationField(value.field)) {
    throw new Error(`Reservation setting ${name} has an invalid field.`);
  }
  if (typeof value.negate !== 'boolean') {
    throw new Error(`Reservation setting ${name} has an invalid NOT setting.`);
  }
  if (!Array.isArray(value.values)) {
    throw new Error(`Reservation setting ${name} must include a values array.`);
  }
  if (value.values.length > MAX_VALUES_PER_RULE) {
    throw new Error(
      `Reservation setting ${name} supports at most ${MAX_VALUES_PER_RULE} keywords.`,
    );
  }
  const values = value.values.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(
        `Reservation setting ${name} keyword ${index + 1} must be a string.`,
      );
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) {
      throw new Error(
        `Reservation setting ${name} keywords must contain 1-${MAX_VALUE_LENGTH} characters.`,
      );
    }
    return trimmed;
  });
  return {
    type: 'rule',
    id,
    field: value.field,
    join: parseOperator(value.join, `${name} join`),
    negate: value.negate,
    values,
  };
}

function parseId(value: unknown, name: string, ids: Set<string>): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
    throw new Error(`Reservation setting ${name} has an invalid id.`);
  }
  if (ids.has(value)) {
    throw new Error(`Reservation setting ${name} has a duplicate id.`);
  }
  ids.add(value);
  return value;
}

function parseOperator(value: unknown, name: string): MatchOperator {
  if (value !== 'and' && value !== 'or') {
    throw new Error(`Reservation setting ${name} has an invalid operator.`);
  }
  return value;
}

function evaluateChildren(
  children: ReservationExpressionNode[],
  book: Pick<NewBook, 'title' | 'author' | 'publisher'>,
): boolean {
  if (children.length === 0) return false;
  let completedOrSegments = false;
  let andSegment = evaluateNode(children[0], book);
  for (const child of children.slice(1)) {
    const value = evaluateNode(child, book);
    if (child.join === 'or') {
      completedOrSegments = completedOrSegments || andSegment;
      andSegment = value;
    } else {
      andSegment = andSegment && value;
    }
  }
  return completedOrSegments || andSegment;
}

function evaluateNode(
  node: ReservationExpressionNode,
  book: Pick<NewBook, 'title' | 'author' | 'publisher'>,
): boolean {
  if (node.type === 'group') return evaluateChildren(node.children, book);
  const actualValue =
    node.field === 'publishers'
      ? book.publisher
      : node.field === 'authors'
        ? book.author
        : book.title;
  const actual = normalize(actualValue);
  const matches = node.values.map((value) => {
    const expected = normalize(value);
    return node.field === 'titleKeywords'
      ? actual.includes(expected)
      : actual === expected;
  });
  const result = matches.some(Boolean);
  return node.negate ? !result : result;
}

function hasActiveChildren(children: ReservationExpressionNode[]): boolean {
  return children.some((node) =>
    node.type === 'group'
      ? hasActiveChildren(node.children)
      : node.values.length > 0,
  );
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ja-JP');
}

function isReservationField(value: unknown): value is ReservationField {
  return (
    value === 'publishers' || value === 'authors' || value === 'titleKeywords'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
