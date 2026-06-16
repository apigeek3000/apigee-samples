import styles from './LoginScreen.module.css'

interface Props {
  onSignIn: () => void
  denied?: boolean
  deniedEmail?: string
  onSignOut?: () => void
}

export function LoginScreen({ onSignIn, denied, deniedEmail, onSignOut }: Props) {
  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <img src="/favicon.ico" alt="" className={styles.logo} />
        <h1 className={styles.title}>Apigee Superdemo</h1>
        {denied ? (
          <>
            <p className={styles.denied}>
              <strong>{deniedEmail}</strong> is not authorized to use this app.
            </p>
            <p className={styles.hint}>
              Ask an administrator to add your account, then sign in again.
            </p>
            <button type="button" className={styles.button} onClick={onSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className={styles.hint}>Sign in with your Google account to continue.</p>
            <button type="button" className={styles.button} onClick={onSignIn}>
              Sign in with Google
            </button>
          </>
        )}
      </div>
    </div>
  )
}
