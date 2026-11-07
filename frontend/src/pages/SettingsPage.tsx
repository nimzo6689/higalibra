import { useId } from 'react';
import { Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { PageIntro } from '../components';
import type { ReservationCriterion, ReservationSettings } from '../types';

const criteria = [
  {
    key: 'publishers',
    title: '出版社',
    hint: '出版社名を入力します。複数指定時は選んだ条件で照合します。',
  },
  {
    key: 'authors',
    title: '著者',
    hint: '著者名を入力します。複数指定時は選んだ条件で照合します。',
  },
  {
    key: 'titleKeywords',
    title: 'タイトルのキーワード',
    hint: 'タイトルに含まれるキーワードを指定します（部分一致）。',
  },
] as const;

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
              入力した項目どうしはAND条件です。各項目内ではANDまたはORを選べます。
              条件をすべて空にすると、その利用者の自動予約は行いません。
            </p>
            {criteria.map(({ key, title, hint }) => (
              <CriterionEditor
                key={key}
                title={title}
                hint={hint}
                criterion={settings[key]}
                onChange={(criterion) =>
                  onChange({ ...settings, [key]: criterion })
                }
              />
            ))}

            {message && (
              <p className="settings-feedback" role="status">
                {message}
              </p>
            )}
            <div className="settings-actions">
              <span>各項目20個まで、1つの値は100文字まで入力できます。</span>
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

function CriterionEditor({
  title,
  hint,
  criterion,
  onChange,
}: {
  title: string;
  hint: string;
  criterion: ReservationCriterion;
  onChange: (criterion: ReservationCriterion) => void;
}) {
  const id = useId();
  return (
    <fieldset className="settings-criterion">
      <legend>{title}</legend>
      <p>{hint}</p>
      <div className="settings-operator">
        <label htmlFor={`${id}-operator`}>複数の値の照合</label>
        <select
          id={`${id}-operator`}
          value={criterion.operator}
          onChange={(event) =>
            onChange({
              ...criterion,
              operator: event.target.value === 'and' ? 'and' : 'or',
            })
          }
        >
          <option value="or">OR（いずれかに一致）</option>
          <option value="and">AND（すべてに一致）</option>
        </select>
      </div>
      <div className="settings-values">
        {criterion.values.map((value, index) => (
          <div className="settings-value-row" key={`${id}-${index}`}>
            <label className="sr-only" htmlFor={`${id}-value-${index}`}>
              {title} {index + 1}
            </label>
            <input
              id={`${id}-value-${index}`}
              value={value}
              maxLength={100}
              onChange={(event) =>
                onChange({
                  ...criterion,
                  values: criterion.values.map((current, valueIndex) =>
                    valueIndex === index ? event.target.value : current,
                  ),
                })
              }
              placeholder={`${title}を入力`}
            />
            <button
              type="button"
              className="settings-remove"
              aria-label={`${title} ${index + 1} を削除`}
              onClick={() =>
                onChange({
                  ...criterion,
                  values: criterion.values.filter(
                    (_, valueIndex) => valueIndex !== index,
                  ),
                })
              }
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="settings-add"
        disabled={criterion.values.length >= 20}
        onClick={() =>
          onChange({ ...criterion, values: [...criterion.values, ''] })
        }
      >
        <Plus size={16} />
        条件を追加
      </button>
    </fieldset>
  );
}
