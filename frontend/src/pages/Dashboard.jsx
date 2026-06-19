import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarCapitulos, subirCapitulo } from '../services/api';

const ETIQUETAS_ESTADO = {
  pendiente: 'Pendiente',
  transcribiendo: 'Transcribiendo',
  analizando: 'Analizando',
  listo: 'Listo',
  error: 'Error',
};

const EXTENSIONES_ACEPTADAS = ['.mp3', '.ogg', '.oga', '.m4a', '.wav'];

export default function Dashboard() {
  const [capitulos, setCapitulos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);

  const [archivo, setArchivo] = useState(null);
  const [fecha, setFecha] = useState('');
  const [titulo, setTitulo] = useState('');

  const inputRef = useRef(null);

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
    const intervalo = setInterval(cargarCapitulos, 10000);
    return () => clearInterval(intervalo);
  }, []);

  function archivoValido(file) {
    const nombre = file.name.toLowerCase();
    return EXTENSIONES_ACEPTADAS.some((ext) => nombre.endsWith(ext));
  }

  function seleccionarArchivo(file) {
    if (!file) return;
    if (!archivoValido(file)) {
      setError('Formato no soportado. Usa MP3, OGG, M4A o WAV.');
      return;
    }
    setError(null);
    setArchivo(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setArrastrando(false);
    const file = e.dataTransfer.files?.[0];
    seleccionarArchivo(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!archivo || !fecha) {
      setError('Selecciona un archivo de audio y la fecha del sermón');
      return;
    }

    try {
      setSubiendo(true);
      setProgreso(0);
      setError(null);
      await subirCapitulo({ audio: archivo, fecha_sermon: fecha, titulo }, setProgreso);
      setArchivo(null);
      setFecha('');
      setTitulo('');
      if (inputRef.current) inputRef.current.value = '';
      await cargarCapitulos();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Error al subir el audio');
    } finally {
      setSubiendo(false);
      setProgreso(0);
    }
  }

  return (
    <div className="page">
      <p className="page__eyebrow">Tu colección de sermones</p>
      <h1 className="page__title">Capítulos del libro</h1>
      <hr className="page__rule" />

      <div className="panel">
        <span className="panel__ribbon"></span>
        <div className="section-header">
          <span className="section-header__icon">♪</span>
          <div>
            <h2 className="section-header__title">Subir nuevo sermón</h2>
            <p className="section-header__subtitle">
              El audio se transcribe y analiza automáticamente. Podrás revisarlo apenas esté listo.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="field__label">Archivo de audio</label>
            <div
              className={`dropzone ${arrastrando ? 'dropzone--active' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
            >
              <div className="dropzone__icon">✒</div>
              <div className="dropzone__text">
                <strong>Arrastra el audio aquí</strong> o haz clic para seleccionar
              </div>
              <div className="dropzone__hint">MP3 · OGG · M4A · WAV</div>
              {archivo && (
                <div className="dropzone__file">{archivo.name}</div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".mp3,.ogg,.oga,.m4a,.wav,audio/*"
                onChange={(e) => seleccionarArchivo(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label">Fecha del sermón</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label">Título (opcional)</label>
            <input
              type="text"
              placeholder="Ej. La fe que mueve montañas"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          {error && <p style={{ color: 'var(--rust)' }}>{error}</p>}

          <button className="btn btn--primary" type="submit" disabled={subiendo}>
            {subiendo ? 'Subiendo...' : 'Subir y procesar'}
          </button>

          {subiendo && (
            <div className="progress">
              <div className="progress__track">
                <div className="progress__fill" style={{ width: `${progreso}%` }} />
              </div>
              <p className="progress__label">
                {progreso < 100 ? `Subiendo audio... ${progreso}%` : 'Procesando en el servidor...'}
              </p>
            </div>
          )}
        </form>
      </div>

      <div className="panel">
        <span className="panel__ribbon panel__ribbon--forest"></span>
        <div className="section-header">
          <span className="section-header__icon">§</span>
          <div>
            <h2 className="section-header__title">Tabla de contenido</h2>
            <p className="section-header__subtitle">Cada sermón aparece aquí en cuanto se sube.</p>
          </div>
        </div>

        {cargando ? (
          <div className="empty-state">
            <span className="empty-state__icon">···</span>
            <p className="empty-state__text">Cargando capítulos...</p>
          </div>
        ) : capitulos.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">Aún en blanco</span>
            <p className="empty-state__text">Aún no hay capítulos. Sube tu primer sermón arriba.</p>
          </div>
        ) : (
          <div className="chapter-list">
            {capitulos.map((cap, i) => (
              <Link to={`/capitulos/${cap.id}`} key={cap.id} className="chapter-card">
                <span className="chapter-card__num">{String(i + 1).padStart(2, '0')}</span>
                <div className="chapter-card__body">
                  <div className="chapter-card__title">
                    {cap.titulo || `Sermón del ${cap.fecha_sermon}`}
                  </div>
                  <div className="chapter-card__meta">
                    {cap.fecha_sermon}
                    {cap.promovido && ' · En el libro'}
                  </div>
                </div>
                <span className={`tag tag--${cap.estado}`}>
                  {ETIQUETAS_ESTADO[cap.estado] || cap.estado}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}