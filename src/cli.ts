
if (process.argv.length) {
    const { Entry } = await import('subscribe/job');
    await Entry(process.argv);
}

await import('./server/startup');

export { };
