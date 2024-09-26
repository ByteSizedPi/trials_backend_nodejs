const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const XLSX = require("xlsx");
const multiparty = require("multiparty");

dotenv.config();

const app = express();
const router = express.Router();

router.use([cors(), express.json(), express.urlencoded({ extended: true })]);

const { QUERIES } = require("./db");
const fs = require("fs");

router.get("/", (_, res) => res.json("Server Works"));

// GET REQUESTS
router.get("/validate/:pw", (req, res) => {
  const password = process.env.APP_ROOT_PASSWORD;
  res.json(req.params.pw === password);
});

router.get("/events/all", async (req, res) => {
  res.json(await QUERIES.ALL_EVENTS());
});

router.get("/events/upcoming", async (req, res) => {
  res.json(await QUERIES.UPCOMING_EVENTS());
});

router.get("/events/completed", async (req, res) => {
  res.json(await QUERIES.COMPLETED_EVENTS());
});

router.get("/events/:event_id", async (req, res) => {
  res.json(await QUERIES.EVENT(req.params.event_id));
});

router.get("/events/:event_id/sections/all", async (req, res) => {
  const sections = await QUERIES.ALL_SECTIONS(req.params.event_id);
  res.json({ sections: sections.map((n) => n.section_number) });
});

router.get("/events/:event_id/riders/all", async (req, res) => {
  res.json(await QUERIES.ALL_RIDERS(req.params.event_id));
});

router.get("/events/:event_id/scores", async (req, res) => {
  const { section_number, rider_number } = req.query;
  res.json(
    await QUERIES.GET_SCORES(req.params.event_id, section_number, rider_number)
  );
});

router.get("/template", (req, res) => {
  try {
    const filePath = path.join(
      __dirname,
      "static",
      "riding_numbers_template.xlsx"
    );
    res.download(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "File could not be served" });
  }
});

router.get("/results_summary/:event_id", async (req, res) => {
  res.json(await QUERIES.GET_SCORES_SUMMARY_BY_EVENTID(req.params.event_id));
});

// router.get("/results_summary/:event_id/excel", async (req, res) => {
//     const event_id = req.params.event_id;
//     try {
//         const filePath = path.join(__dirname, "static", `${event_id}.xlsx`);
//         res.download(filePath);
//     } catch (e) {
//         console.error(e);
//         res.status(500).json({ message: "File could not be served" });
//     }
// });

// POST REQUESTS
router.post("/score", async (req, res) => {
  const { event_id, section_number, rider_number, score, lap_number } =
    req.body;

  res.json(
    await QUERIES.POST_SCORE(
      event_id,
      section_number,
      rider_number,
      lap_number,
      score
    )
  );
});

router.put("/score", async (req, res) => {
  const { event_id, section_number, rider_number, score, lap_number } =
    req.body;

  res.json(
    await QUERIES.UPDATE_SCORE(
      event_id,
      section_number,
      rider_number,
      lap_number,
      score
    )
  );
});

router.post("/event", async (req, res) => {
  const form = new multiparty.Form();

  form.parse(req, async (err, fields, files) => {
    const newFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value[0]])
    );

    const {
      event_name,
      event_location,
      event_date,
      sections,
      lap_count,
      password,
    } = newFields;

    if (isNaN(sections) || isNaN(lap_count))
      res
        .status(400)
        .json({ message: "Sections and Lap Count must be an integer" });

    console.log(files.file[0]);

    const workbook = XLSX.readFile(files.file[0].path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 2 });
    const columnNames = data[0];

    const requiredColumns = ["NUMBER", "NAME", "CLASS"];
    const missingColumns = requiredColumns.filter(
      (col) => !columnNames.includes(col)
    );

    if (missingColumns.length) {
      res
        .status(400)
        .json({ message: `Missing columns: ${missingColumns.join(", ")}` });
    }

    res.status(400).json({ message: "Event creation failed" });
  });
});

router.put("/event/:event_id", async ({ params: { event_id } }, res) => {
  res.json(await QUERIES.COMPLETE_EVENT(event_id));
});

router.delete("/event/:event_id", async ({ params: { event_id } }, res) => {
  res.json(await QUERIES.DELETE_EVENT(event_id));
});

router.get(
  "/event/:event_id/validate/:password",
  async ({ params: { event_id, password } }, res) => {
    res.json(!!(await QUERIES.VERIFY_EVENT_PASSWORD(event_id, password)));
  }
);

router.get(
  "/event/:event_id/has_password",
  async ({ params: { event_id } }, res) => {
    res.json(!!(await QUERIES.EVENT_HAS_PASSWORD(event_id))[0]["password"]);
  }
);

const PORT = process.env.PORT || 3000;

app.use("/api", router);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
