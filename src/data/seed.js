import dailyLog from './daily_log.json';
import meds from './meds.json';
import vax from './vax.json';
import feed from './feed.json';
import feedStandard from './feed_standard.json';

export const SEED = {
  flock: {
    farmName: 'AI Farms',
    flockName: 'Layer Flock — Hy-Line',
    breed: 'Hy-Line Layers',
    startDate: '2026-05-01',
    initialBirds: 472,
    location: 'Eikwe, Western Region',
  },
  dailyLog,
  meds,
  vax,
  feed,
  feedStandard,
  weightSamples: [],
};
