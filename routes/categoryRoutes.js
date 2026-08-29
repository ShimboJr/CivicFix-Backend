const express = require('express');
const router  = express.Router();
const { getPublicCategories } = require('../controllers/categoryController');

// GET /api/categories — public
router.get('/', getPublicCategories);

module.exports = router;
