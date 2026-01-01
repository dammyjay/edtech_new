const express = require('express');
const router = express.Router();
const controller = require('../controllers/companyController');

router.get('/company', controller.showForm);
router.post('/company', controller.saveInfo);

module.exports = router;
