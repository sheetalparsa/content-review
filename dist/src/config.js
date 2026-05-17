export const config = {
    port: parseInt(process.env.PORT || "3000", 10),
    dbPath: process.env.DB_PATH || "./data/app.db",
    reservationTtlSeconds: parseInt(process.env.RESERVATION_TTL_SECONDS || "1200", 10),
    releaseSweepIntervalSeconds: parseInt(process.env.RELEASE_SWEEP_INTERVAL_SECONDS || "30", 10),
    seedOnStartup: (process.env.SEED_ON_STARTUP || "true").toLowerCase() === "true",
    jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me"
};
