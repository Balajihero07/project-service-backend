require('dotenv').config();

const sql = require('./config/db');
const app = require('./app');

const PORT = process.env.PORT || 5000;

app.get('/', async (req, res) => {
    try {
        const result = await sql`SELECT version()`;
        const time = await sql`SELECT NOW()`;

        console.log('Database connected:', result[0].version);
        console.log('Database time:', time[0].now);

        res.json({
            success: true,
            message: 'Project Service Backend is running',
            database: 'Connected',
            version: result[0].version,
            serverTime: time[0].now
        });
    } catch (error) {
        console.error('Database connection error:', error);

        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`❤️ Health: http://localhost:${PORT}/api/health`);
});