import { isValidEnvName } from '../shared/env-vars';
import type { EnvVarRow } from '../shared/env-vars';

interface Props {
  rows: EnvVarRow[];
  onChange: (rows: EnvVarRow[]) => void;
}

export default function EnvVarsEditor({ rows, onChange }: Props) {
  const update = (index: number, patch: Partial<EnvVarRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const hasInvalid = rows.some((r) => r.name !== '' && !isValidEnvName(r.name));

  return (
    <div className="env-vars-editor">
      {rows.map((row, i) => {
        const invalid = row.name !== '' && !isValidEnvName(row.name);
        return (
          <div key={i} className="env-var-row">
            <input
              type="text"
              className={`env-var-name${invalid ? ' env-var-invalid' : ''}`}
              value={row.name}
              placeholder="NAME"
              title={invalid ? 'Letters, digits and _ only; cannot start with a digit' : undefined}
              spellCheck={false}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              type="text"
              className="env-var-value"
              value={row.value}
              placeholder="value"
              spellCheck={false}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="env-var-remove"
              aria-label="Remove variable"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      {hasInvalid && <div className="env-vars-note">Rows with invalid names are not saved.</div>}
      <button
        type="button"
        className="env-var-add"
        onClick={() => onChange([...rows, { name: '', value: '' }])}
      >
        Add variable
      </button>
    </div>
  );
}
