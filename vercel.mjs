const artifact = process.env.PAYME_VERCEL_ARTIFACT;

if (artifact !== 'app' && artifact !== 'landing') {
  throw new Error('PAYME_VERCEL_ARTIFACT debe ser exactamente app o landing');
}

const paths = ['/privacy', '/facebook-data-deletion/:code'];
const headers = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

export const config = {
  git: { deploymentEnabled: { main: false } },
  rewrites: artifact === 'app'
    ? paths.map((source) => ({ source, destination: '/index.html' }))
    : [],
  headers: artifact === 'app'
    ? paths.map((source) => ({ source, headers }))
    : [],
};
