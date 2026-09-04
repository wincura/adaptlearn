import { createApp } from './app.ts';

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`AdaptLearn API ready at http://localhost:${port}`);
});
