import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import carouselRoutes from './Routes/carouselRoutes.js';
import productRoutes from './Routes/productRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/carousel', carouselRoutes);
app.use('/api/products', productRoutes);

// Debug route to test server
app.get('/', (req, res) => {
    res.send('Server is running');
});

// Debug route to test products endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working', routes: ['/api/products', '/api/products/filters', '/api/carousel'] });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});