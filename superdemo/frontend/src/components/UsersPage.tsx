import { useEffect, useState, type FormEvent } from 'react'
import { addAllowlistEntry, getAllowlist, removeAllowlistEntry } from '../api'
import type { Allowlist, AllowlistKind, ApiError } from '../types'
import styles from './UsersPage.module.css'

interface SectionConfig {
  kind: AllowlistKind
  title: string
  caption: string
  placeholder: string
}

const SECTIONS: SectionConfig[] = [
  {
    kind: 'admins',
    title: 'Admins',
    caption: 'Admins can sign in and manage this page.',
    placeholder: 'admin@example.com',
  },
  {
    kind: 'domains',
    title: 'Domains',
    caption: 'Anyone with an email address at these domains can sign in.',
    placeholder: 'example.com',
  },
  {
    kind: 'emails',
    title: 'Emails',
    caption: 'These exact addresses can sign in.',
    placeholder: 'person@example.com',
  },
]

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as ApiError).message)
  }
  return String(err)
}

export function UsersPage() {
  const [allowlist, setAllowlist] = useState<Allowlist | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    getAllowlist()
      .then(setAllowlist)
      .catch((err: unknown) => setLoadError(errorMessage(err)))
  }, [])

  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>Users</h2>
      {loadError && (
        <p role="alert" className={styles.error}>
          {loadError}
        </p>
      )}
      {!loadError && !allowlist && <p className={styles.dim}>Loading…</p>}
      {allowlist &&
        SECTIONS.map((section) => (
          <AllowlistSection
            key={section.kind}
            {...section}
            entries={allowlist[section.kind]}
            onChange={setAllowlist}
          />
        ))}
    </div>
  )
}

interface SectionProps extends SectionConfig {
  entries: string[]
  onChange: (allowlist: Allowlist) => void
}

function AllowlistSection({ kind, title, caption, placeholder, entries, onChange }: SectionProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<Allowlist>, onSuccess?: () => void) {
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      onSuccess?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    void run(() => addAllowlistEntry(kind, value), () => setValue(''))
  }

  return (
    <section className={styles.section} aria-label={title}>
      <h3>{title}</h3>
      <p className={styles.caption}>{caption}</p>
      {entries.length === 0 ? (
        <p className={styles.dim}>None yet.</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry} className={styles.entry}>
              <span>{entry}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${entry}`}
                disabled={busy}
                onClick={() => void run(() => removeAllowlistEntry(kind, entry))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.addRow} onSubmit={handleSubmit}>
        <input
          aria-label={`Add to ${title}`}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  )
}
