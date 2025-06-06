require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const logger = require("./utils/logger");
const apiRoutes = require('./routes/apiRoutes');

// Basic middleware
app.use(express.json());

// Add API routes
app.use('/api', apiRoutes);

// Simple routes
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.json({ message: "Server running" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});