import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarCapitulos, subirCapitulo } from '../services/api';

const ETIQUETAS_ESTADO = {
  pendiente: 'Pendiente',
  transcribiendo: 'Transcribiendo...',
  analizando: 'Analizando con IA...',
  listo: 'Listo para revisar',
  error: 'Error',
};

export default function Dashboard() {
  const [capitulos, setCapitulos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);

  // Formulario
  const [archivo, setArchivo] = useState(null);
  const [fecha, setFecha] = useState('');
  const [titulo, setTitulo] = useState('');

  async function cargarCapitulos() {
    try {
      setCargando(true);
      const data = await listarCapitulos();
      setCapitulos(data);
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los capítulos');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarCapitulos();

    // Refrescar automáticamente la lista cada 10s mientras haya
    // capítulos en proceso (transcribiendo/analizando)
    const intervalo = setInterval(() => {
      cargarCapitulos();
    }, 10000);

    return () => clearInterval(intervalo);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!archivo || !fecha) {
      setError('Selecciona un archivo MP3 y la fecha del sermón');
      return;
    }

    try {
      setSubiendo(true);
      setError(null);
      await subirCapitulo({ audio: archivo, fecha_sermon: fecha, titulo });
      setArchivo(null);
      setFecha('');
      setTitulo('');
      e.target.reset();
      await cargarCapitulos();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Error al subir el audio');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="contenedor">
      <h1>Capítulos del libro</h1>

      <div className="card">
        <h2>Subir nuevo sermón</h2>
        <form onSubmit={handleSubmit}>
          <div className="campo">
            <label>Archivo MP3</label>
            <input
              type="file"
              accept=".mp3,audio/mpeg"
              onChange={(e) => setArchivo(e.target.files[0])}
            />
          </div>
          <div className="campo">
            <label>Fecha del sermón</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="campo">
            <label>Título (opcional)</label>
            <input
              type="text"
              placeholder="Ej. La fe que mueve montañas"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          {error && <p style={{ color: '#dc2626' }}>{error}</p>}

          <button className="boton" type="submit" disabled={subiendo}>
            {subiendo ? 'Subiendo...' : 'Subir y procesar'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Capítulos</h2>
        {cargando ? (
          <p>Cargando...</p>
        ) : capitulos.length === 0 ? (
          <p>Aún no hay capítulos. Sube tu primer sermón arriba.</p>
        ) : (
          <div className="lista-capitulos">
            {capitulos.map((cap) => (
              <div key={cap.id} className="item-capitulo">
                <div>
                  <Link to={`/capitulos/${cap.id}`}>
                    {cap.titulo || `Sermón del ${cap.fecha_sermon}`}
                  </Link>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {cap.fecha_sermon}
                    {cap.promovido && ' · En el libro'}
                  </div>
                </div>
                <span className={`badge badge-${cap.estado}`}>
                  {ETIQUETAS_ESTADO[cap.estado] || cap.estado}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
