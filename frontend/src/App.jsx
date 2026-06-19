import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CapituloEditorPage from './pages/CapituloEditor';
import LibroPreview from './pages/LibroPreview';

const ORNAMENTOS = [
  { simbolo: '✠', top: '8%', left: '6%', size: '64px', rot: '-8deg', delay: '0s' },
  { simbolo: '❧', top: '18%', left: '88%', size: '90px', rot: '6deg', delay: '-6s' },
  { simbolo: '☙', top: '62%', left: '3%', size: '78px', rot: '4deg', delay: '-12s' },
  { simbolo: '❦', top: '78%', left: '92%', size: '70px', rot: '-5deg', delay: '-3s' },
  { simbolo: '✒', top: '42%', left: '50%', size: '56px', rot: '10deg', delay: '-9s' },
  { simbolo: '☩', top: '30%', left: '30%', size: '46px', rot: '-12deg', delay: '-15s' },
];

export default function App() {
  return (
    <div>
      <div className="bg-decor" aria-hidden="true">
        {ORNAMENTOS.map((o, i) => (
          <span
            key={i}
            className="bg-decor__item"
            style={{
              top: o.top,
              left: o.left,
              fontSize: o.size,
              '--rot': o.rot,
              animationDelay: o.delay,
            }}
          >
            {o.simbolo}
          </span>
        ))}
      </div>

      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__monogram">P</span>
          <span className="topbar__title">Cuaderno de Prédicas</span>
          <span className="topbar__subtitle">cada sermón, una página</span>
        </div>
        <div className="topbar__right">
          <span className="topbar__status">
            <span className="topbar__status-dot"></span>
            En línea
          </span>
          <nav className="topbar__nav">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `topbar__link ${isActive ? 'topbar__link--active' : ''}`
              }
              end
            >
              Capítulos
            </NavLink>
            <NavLink
              to="/libro"
              className={({ isActive }) =>
                `topbar__link ${isActive ? 'topbar__link--active' : ''}`
              }
            >
              Libro
            </NavLink>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/capitulos/:id" element={<CapituloEditorPage />} />
        <Route path="/libro" element={<LibroPreview />} />
      </Routes>
    </div>
  );
}