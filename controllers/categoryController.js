const asyncHandler = require('express-async-handler');
const Category     = require('../models/Category');

// ─── @desc    Get all categories (public — used by report form)
// ─── @route   GET /api/categories
// ─── @access  Public
const getPublicCategories = asyncHandler(async (_req, res) => {
  const categories = await Category.find().sort({ name: 1 }).lean();
  res.status(200).json(categories);
});

module.exports = { getPublicCategories };
