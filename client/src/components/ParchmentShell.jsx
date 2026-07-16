import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth.js';

/** Marco claro (pergamino) con navegación para las pantallas entre sesiones. */
export default function ParchmentShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate('/acceso');
  }

  const navClass = ({ isActive }) =>
    `font-display text-sm tracking-wide transition-colors ${
      isActive ? 'text-ember' : 'text-ink/70 hover:text-ink'
    }`;

  return (
    <div className="min-h-full bg-gradient-to-b from-parchment-100 to-parchment-200 text-ink">
      <header className="flex items-center justify-between border-b border-ink/20 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <h1 className="font-display text-xl font-bold tracking-wider">TriDnD</h1>
          <nav className="flex gap-4">
            <NavLink to="/" end className={navClass}>Campañas</NavLink>
            <NavLink to="/personajes" className={navClass}>Personajes</NavLink>
            <NavLink to="/compendio" className={navClass}>Compendio</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink/70 sm:inline">{user?.displayName}</span>
          <button
            onClick={onLogout}
            className="rounded-sm border border-ink/30 px-3 py-1 font-display text-sm tracking-wide transition-colors hover:bg-ink/10"
          >
            Salir
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
