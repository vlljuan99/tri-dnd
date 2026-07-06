import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../store/auth.js';

const inputClass =
  'w-full rounded-sm border border-ink/30 bg-parchment-100 px-3 py-2 text-ink ' +
  'placeholder:text-ink/40 focus:border-ochre focus:outline-none focus:ring-1 focus:ring-ochre';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, displayName, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-b from-parchment-100 to-parchment-200 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <h1 className="mb-1 text-center font-display text-4xl font-bold tracking-wider text-ink">
          TriDnD
        </h1>
        <p className="mb-8 text-center italic text-ink/70">
          La mesa de juego de vuestro grupo
        </p>

        <div className="rounded-md border border-ink/20 bg-parchment-100/70 p-6 shadow-lg shadow-ink/10">
          <div className="mb-5 flex gap-1 rounded-sm border border-ink/20 p-1">
            {[
              ['login', 'Entrar'],
              ['register', 'Crear cuenta'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError('');
                }}
                className={`flex-1 rounded-sm py-1.5 font-display text-sm tracking-wide transition-colors ${
                  mode === value
                    ? 'bg-ochre text-parchment-100'
                    : 'text-ink/70 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Usuario</label>
              <input
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <AnimatePresence>
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <label className="mb-1 block text-sm font-medium text-ink/80">
                    Nombre visible <span className="font-normal text-ink/50">(opcional)</span>
                  </label>
                  <input
                    className={inputClass}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Cómo te verá el grupo"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Contraseña</label>
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="rounded-sm border border-blood/40 bg-blood/10 px-3 py-2 text-sm text-blood">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-ember py-2 font-display tracking-wide text-parchment-100 transition-colors hover:bg-ember/90 disabled:opacity-50"
            >
              {busy ? 'Un momento…' : mode === 'login' ? 'Entrar al campamento' : 'Unirse a la aventura'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
