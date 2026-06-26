import app from './app.js';
import { despertarWorker } from './services/worker.service.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Backend escuchando en el puerto ${PORT}`);
  despertarWorker('arranque del backend');
});