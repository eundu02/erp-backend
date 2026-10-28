const express = require('express');
const cors = require('cors');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const productsRouter = require('./routes/products');
const suppliersRouter = require('./routes/suppliers');
const inventoryRouter = require('./routes/inventory');
const stockMovementsRouter = require('./routes/stockMovements');
const salesRouter = require('./routes/sales');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const receiptsRouter = require('./routes/receipts');
const recommendationsRouter = require('./routes/recommendations');
const decisionsRouter = require('./routes/decisions');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/products', productsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/stock-movements', stockMovementsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/decisions', decisionsRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
