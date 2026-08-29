const mongoose = require('mongoose');

// ─── Schema ───────────────────────────────────────────────────────────────────
const categorySchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Category name is required'],
      unique:   true,
      trim:     true,
    },

    // Bootstrap Icons class name, e.g. "bi-lightbulb", "bi-droplet", "bi-trash"
    icon: {
      type:    String,
      default: 'bi-tag',
    },
  },
  {
    timestamps: true,
  }
);

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
