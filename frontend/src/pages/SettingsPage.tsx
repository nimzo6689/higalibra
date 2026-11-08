import { useId, useState } from 'react';
import { Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import { PageIntro } from '../components';
import type {
  MatchOperator,
  ReservationExpression,
  ReservationExpressionNode,
  ReservationField,
  ReservationRule,
  ReservationSettings,
} from '../types';

const criteria: {
  field: ReservationField;
  title: string;
  addLabel: string;
  hint: string;
}[] = [
  {
    field: 'publishers',
    title: '出版社',
    addLabel: '+ 出版社を追加',
    hint: '出版社名のいずれか（またはすべて）に一致する条件です。',
  },
  {
    field: 'authors',
    title: '著者',
    addLabel: '+ 著者名を追加',
    hint: '著者名のいずれか（またはすべて）に一致する条件です。',
  },
  {
    field: 'titleKeywords',
    title: 'タイトル',
    addLabel: '+ タイトルを追加',
    hint: 'タイトルに含まれるキーワードを部分一致で照合します。',
  },
];

export function SettingsPage({
  settings,
  isLoading,
  isSaving,
  error,
  message,
  onRetry,
  onChange,
  onSave,
}: {
  settings: ReservationSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  message: string;
  onRetry: () => void;
  onChange: (settings: ReservationSettings) => void;
  onSave: () => void;
}) {
  return (
    <div className="page-stack settings-page">
      <PageIntro
        eyebrow="RESERVATION RULES"
        title="予約設定"
        subtitle="条件に合う新着書籍を、設定した利用者のカード番号で自動予約します。"
        icon={<Settings2 size={24} />}
      />

      <section className="settings-panel" aria-label="新着書籍の予約条件">
        {error && (
          <p className="settings-feedback is-error" role="alert">
            {error}
          </p>
        )}
        {isLoading ? (
          <p className="settings-loading" role="status">
            予約設定を読み込んでいます
          </p>
        ) : !settings ? (
          <button type="button" className="settings-add" onClick={onRetry}>
            予約設定を再読み込み
          </button>
        ) : (
          <>
            <p className="settings-guidance">
              条件は上から評価し、ANDはORより優先されます。グループで条件を囲むと、
              その中を先に評価できます。NOTで条件を反転できます。キーワードは入力後に
              Enterキーでタグとして追加してください。すべての条件を削除すると、
              自動予約は行いません。
            </p>
            <ExpressionGroupEditor
              group={settings.expression}
              isRoot
              depth={0}
              totalRuleCount={countRules(settings.expression.children)}
              onChange={(expression) => onChange({ ...settings, expression })}
            />

            {message && (
              <p className="settings-feedback" role="status">
                {message}
              </p>
            )}
            <div className="settings-actions">
              <span>
                条件は最大60件、各条件のキーワードは20個まで（1個100文字まで）。
                グループは3階層まで追加できます。
              </span>
              <button
                type="button"
                className="settings-save"
                onClick={onSave}
                disabled={isSaving}
              >
                <Save size={17} />
                {isSaving ? '保存中…' : '設定を保存'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ExpressionGroupEditor({
  group,
  isRoot,
  depth,
  totalRuleCount,
  onChange,
  onUngroup,
  onRemove,
}: {
  group: ReservationExpression;
  isRoot: boolean;
  depth: number;
  totalRuleCount: number;
  onChange: (group: ReservationExpression) => void;
  onUngroup?: () => void;
  onRemove?: () => void;
}) {
  const updateNode = (index: number, node: ReservationExpressionNode) =>
    onChange({
      children: group.children.map((current, nodeIndex) =>
        nodeIndex === index ? node : current,
      ),
    });
  const removeNode = (index: number) =>
    onChange({
      children: group.children.filter((_, nodeIndex) => nodeIndex !== index),
    });
  const canAddGroup = depth + 1 + maxNestedGroupDepth(group.children) <= 3;

  return (
    <div className={isRoot ? 'settings-expression' : 'settings-group'}>
      {!isRoot && (
        <div className="settings-group-heading">
          <strong>グループ</strong>
          <div>
            <button
              type="button"
              className="settings-text-button"
              onClick={onUngroup}
            >
              グループを解除
            </button>
            <button
              type="button"
              className="settings-remove"
              aria-label="グループと中の条件を削除"
              onClick={onRemove}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="settings-expression-children">
        {group.children.map((node, index) => (
          <div className="settings-expression-row" key={node.id}>
            {index > 0 && (
              <OperatorSelect
                value={node.join}
                label="先行条件との結合"
                onChange={(join) => updateNode(index, { ...node, join })}
              />
            )}
            {node.type === 'rule' ? (
              <RuleEditor
                rule={node}
                onChange={(rule) => updateNode(index, rule)}
                onRemove={() => removeNode(index)}
              />
            ) : (
              <ExpressionGroupEditor
                group={{ children: node.children }}
                isRoot={false}
                depth={depth + 1}
                totalRuleCount={totalRuleCount}
                onChange={(nextGroup) =>
                  updateNode(index, { ...node, children: nextGroup.children })
                }
                onUngroup={() =>
                  onChange({
                    children: [
                      ...group.children.slice(0, index),
                      ...node.children.map((child, childIndex) =>
                        childIndex === 0
                          ? { ...child, join: node.join }
                          : child,
                      ),
                      ...group.children.slice(index + 1),
                    ],
                  })
                }
                onRemove={() => removeNode(index)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="settings-add-condition">
        {criteria.map(({ field, addLabel }) => (
          <button
            key={field}
            type="button"
            className="settings-add"
            disabled={totalRuleCount >= 60}
            onClick={() =>
              onChange({
                children: [...group.children, createRule(field, 'and')],
              })
            }
          >
            <Plus size={16} />
            {addLabel}
          </button>
        ))}
        {group.children.length > 0 && canAddGroup && (
          <button
            type="button"
            className="settings-add settings-add-group"
            onClick={() =>
              onChange({
                children: [
                  {
                    type: 'group',
                    id: createId(),
                    join: 'and',
                    children: group.children,
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            グループを追加
          </button>
        )}
      </div>
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: ReservationRule;
  onChange: (rule: ReservationRule) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const criterion = criteria.find(({ field }) => field === rule.field);
  const [draft, setDraft] = useState('');
  const [inputError, setInputError] = useState('');

  function addKeywords(raw: string) {
    const additions = raw
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (additions.length === 0) return;
    const values = [...rule.values];
    for (const value of additions) {
      if (value.length > 100) {
        setInputError('キーワードは100文字以内で入力してください。');
        return;
      }
      if (values.includes(value)) continue;
      if (values.length >= 20) {
        setInputError('キーワードは1条件につき20個までです。');
        return;
      }
      values.push(value);
    }
    setInputError('');
    onChange({ ...rule, values });
    setDraft('');
  }

  return (
    <div className="settings-rule">
      <div className="settings-rule-heading">
        <strong>{criterion?.title ?? '条件'}</strong>
        <label className="settings-not" htmlFor={`${id}-not`}>
          <input
            id={`${id}-not`}
            type="checkbox"
            checked={rule.negate}
            onChange={(event) =>
              onChange({ ...rule, negate: event.target.checked })
            }
          />
          NOT
        </label>
        <button
          type="button"
          className="settings-remove"
          aria-label={`${criterion?.title ?? '条件'}を削除`}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <p className="settings-rule-hint">{criterion?.hint}</p>
      <div className="settings-rule-options">
        <OperatorSelect
          value={rule.valueOperator}
          label="キーワードの一致"
          onChange={(valueOperator) => onChange({ ...rule, valueOperator })}
        />
      </div>
      <div className="settings-chip-input">
        <div
          className="settings-chips"
          aria-label={`${criterion?.title}のキーワード`}
        >
          {rule.values.map((value, index) => (
            <span className="settings-chip" key={`${value}-${index}`}>
              {value}
              <button
                type="button"
                aria-label={`キーワード「${value}」を削除`}
                onClick={() =>
                  onChange({
                    ...rule,
                    values: rule.values.filter(
                      (_, valueIndex) => valueIndex !== index,
                    ),
                  })
                }
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <input
            id={`${id}-keywords`}
            value={draft}
            maxLength={100}
            aria-label={`${criterion?.title}のキーワードを入力`}
            aria-describedby={inputError ? `${id}-error` : undefined}
            placeholder="キーワードを入力して Enter"
            onChange={(event) => {
              setDraft(event.target.value);
              setInputError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                addKeywords(draft);
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text');
              if (/[,\n]/.test(text)) {
                event.preventDefault();
                addKeywords(text);
              }
            }}
          />
        </div>
        {inputError && (
          <p className="settings-input-error" id={`${id}-error`} role="alert">
            {inputError}
          </p>
        )}
      </div>
    </div>
  );
}

function OperatorSelect({
  value,
  label,
  onChange,
}: {
  value: MatchOperator;
  label: string;
  onChange: (operator: MatchOperator) => void;
}) {
  const id = useId();
  return (
    <label className="settings-operator" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) =>
          onChange(event.target.value === 'or' ? 'or' : 'and')
        }
      >
        <option value="and">AND</option>
        <option value="or">OR</option>
      </select>
    </label>
  );
}

function createRule(
  field: ReservationField,
  join: MatchOperator,
): ReservationRule {
  return {
    type: 'rule',
    id: createId(),
    field,
    join,
    negate: false,
    valueOperator: 'or',
    values: [],
  };
}

function createId(): string {
  return crypto.randomUUID();
}

function countRules(nodes: ReservationExpressionNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.type === 'rule' ? 1 : countRules(node.children)),
    0,
  );
}

function maxNestedGroupDepth(nodes: ReservationExpressionNode[]): number {
  return nodes.reduce(
    (depth, node) =>
      Math.max(
        depth,
        node.type === 'group' ? 1 + maxNestedGroupDepth(node.children) : 0,
      ),
    0,
  );
}
