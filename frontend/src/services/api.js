import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_URL,
});

// ---------- Capítulos ----------

export async function subirCapitulo({ audio, fecha_sermon, titulo }) {
  const formData = new FormData();
  formData.append('audio', audio);
  formData.append('fecha_sermon', fecha_sermon);
  if (titulo) formData.append('titulo', titulo);

  const { data } = await api.post('/capitulos', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listarCapitulos() {
  const { data } = await api.get('/capitulos');
  return data.capitulos;
}

export async function obtenerCapitulo(id) {
  const { data } = await api.get(`/capitulos/${id}`);
  return data.capitulo;
}

export async function obtenerEstadoCapitulo(id) {
  const { data } = await api.get(`/capitulos/${id}/estado`);
  return data.capitulo;
}

export async function actualizarTextoCapitulo(id, texto_actual) {
  await api.patch(`/capitulos/${id}/texto`, { texto_actual });
}

export async function actualizarTituloCapitulo(id, titulo) {
  await api.patch(`/capitulos/${id}/titulo`, { titulo });
}

export async function enviarInstruccion(id, instruccion) {
  const { data } = await api.post(`/capitulos/${id}/instrucciones`, { instruccion });
  return data;
}

export async function promoverCapitulo(id) {
  const { data } = await api.post(`/capitulos/${id}/promover`);
  return data;
}

// ---------- Sugerencias ----------

export async function listarSugerencias(capituloId) {
  const { data } = await api.get(`/capitulos/${capituloId}/sugerencias`);
  return data.sugerencias;
}

export async function aplicarSugerencias(capituloId, sugerenciaIds) {
  const { data } = await api.post(`/capitulos/${capituloId}/sugerencias/aplicar`, {
    sugerencia_ids: sugerenciaIds,
  });
  return data;
}

export async function rechazarSugerencia(sugerenciaId) {
  await api.patch(`/sugerencias/${sugerenciaId}/rechazar`);
}

// ---------- Libro ----------

export async function obtenerLibro() {
  const { data } = await api.get('/libro');
  return data;
}

export async function actualizarConfigLibro(config) {
  const { data } = await api.put('/libro/config', config);
  return data;
}

export async function reordenarLibro(orden) {
  const { data } = await api.put('/libro/orden', { orden });
  return data;
}
