const express = require("express");
const router = express.Router();
const controller = require("../controllers/adminDbController");

// middleware for admin only
// const isAdmin = require("../middlewares/isAdmin");

// router.get("/", isAdmin, controller.showTables);
// router.get("/:table", isAdmin, controller.viewTable);
// router.post("/:table", isAdmin, controller.createRecord);
// router.post("/:table/delete/:id", isAdmin, controller.deleteRecord);

router.get("/", controller.showTables);
router.get("/:table", controller.viewTable);
router.post("/:table", controller.createRecord);
router.post("/:table/delete/:id", controller.deleteRecord);
router.post("/:table/update/:id", controller.updateRecord);
router.get("/:table/data", controller.getTableData);

module.exports = router;