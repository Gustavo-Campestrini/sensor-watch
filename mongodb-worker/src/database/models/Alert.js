const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    type: String,
    value: Number,
    place: String,
    timestamp: { type: Date, default: Date.now },
});

const Alert = mongoose.model('Alert', alertSchema);

module.exports = Alert;