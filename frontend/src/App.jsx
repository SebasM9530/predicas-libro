import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CapituloEditorPage from './pages/CapituloEditor';
import LibroPreview from './pages/LibroPreview';

export default function App() {
  return (
    <div>
      <nav className="navbar">
        <div>
          <Link to="/">Capítulos</Link>
          <Link to="/libro">Libro</Link>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/capitulos/:id" element={<CapituloEditorPage />} />
        <Route path="/libro" element={<LibroPreview />} />
      </Routes>
    </div>
  );
}
