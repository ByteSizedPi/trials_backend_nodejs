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

function relationalRowsToNested(scoresRelational, lap_count, section_count) {
  const sections = Array.from({ length: section_count }, (_, i) => i + 1);

  return scoresRelational.map(
    ({ JSON_scores, rider_number, rider_name, class_name }) => {
      // parse json
      const scores = JSON.parse(JSON_scores);

      // create mapping
      const filledSections = sections.reduce((acc, section) => {
        const score = scores[section] ?? [];

        // construct filledScore
        const filledScore = [
          ...score,
          ...Array(lap_count - score.length).fill(10),
        ];

        // add total field to scores
        return acc.concat(
          filledScore,
          filledScore.reduce((prev, cur) => prev + cur, 0)
        );
      }, []);

      // rows
      return [
        // rider details
        rider_number,
        rider_name,
        class_name,
        // scores
        ...filledSections,
        null,
        // total
        filledSections.reduce((prev, cur) => prev + cur, 0),
      ];
    }
  );
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString("default", { month: "short" });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

router.get(
  "/results_summary/:event_id/xlsx",
  async ({ params: { event_id } }, res) => {
    const { id, event_date, location, name, lap_count, section_count } = (
      await QUERIES.GET_SECTION_BY_EVENTID(event_id)
    )[0];

    const scoresRelational =
      await QUERIES.GET_SCORES_SUMMARY_BY_EVENTID_EXCEL(event_id);

    const scores = relationalRowsToNested(
      scoresRelational.rows,
      lap_count,
      section_count
    );

    const ROW_DIMS = (lap_count + 1) * section_count;

    const sectionStrings = Array.from({ length: ROW_DIMS }, (_, i) => {
      let condition = i % (lap_count + 1) === 0;
      return condition ? "Section " + Math.floor(i / lap_count + 1) : "";
    });

    const lapStrings = Array.from({ length: ROW_DIMS }, (_, i) => {
      const mod = (i % (lap_count + 1)) + 1;
      return mod <= lap_count ? mod : "total";
    });

    const worksheetData = [
      ["Trial: ", name ? `${name} (id: ${id})` : id],
      ["Date: ", formatDate(event_date)],
      ["Location: ", location],
      [],
      ["", "", "", ...sectionStrings, "", "Total", "", "Tie Check"],
      ["Rider Number", "Full Name", "Class", ...lapStrings, 0, 1, 2, 3, 5],
      ...scores,
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Event Results");

    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });
    // // Set headers to indicate a file download and specify the content type
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Results_${event_id}.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    // Send the Excel file as a response
    res.send(excelBuffer);
  }
);

// new / edit scores

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

  const fail = (error) => res.status(400).json({ error });

  form.parse(req, async (err, fields, files) => {
    // flatten fields values
    try {
      const newFields = Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, value[0]])
      );

      const {
        event_name,
        event_location,
        event_date,
        lap_count,
        password,
        sections: section_count,
      } = newFields;

      // validate fields
      if (
        isNaN(section_count) ||
        isNaN(lap_count) ||
        section_count < 1 ||
        lap_count < 1
      ) {
        fail("Sections and Lap Count must be an integer and larger than 1");
      }

      // read riders file
      const workbook = XLSX.readFile(files.file[0].path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // extract riders array from file
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 3 });
      const firstEmptyRow = data.findIndex((row) => row.length === 0);
      const riders = data.slice(0, firstEmptyRow);

      const classes = ["M", "E", "I", "C"];

      // validate riders
      let riderNumbers = new Set();
      riders.forEach(([num, name, klass], i) => {
        // rider number validation
        if (isNaN(num) || num.length === 0)
          fail("Rider number is invalid for rider number " + i);

        if (riderNumbers.has(num))
          fail("Rider number is duplicated for rider number " + i);
        else riderNumbers.add(num);

        // Name validation
        if (!name.length) fail("Rider name is invalid for rider number " + num);

        if (!klass || !classes.includes(klass))
          fail(`Rider class is invalid for rider ${num} (${name})`);
      });

      // create event

      const event_id = await QUERIES.CREATE_EVENT(
        event_name || "Event",
        event_location ?? "",
        event_date,
        section_count,
        lap_count,
        password || ""
      );

      // add sections
      for (let i = 1; i <= section_count; i++)
        await QUERIES.CREATE_SECTION(event_id, i);

      // add riders
      let insertQuery = "";

      for (const [num, name, klass] of riders) {
        const newklass = classes.indexOf(klass) + 1;
        insertQuery += `(${event_id}, ${num}, '${name}', '${newklass}'),`;
      }

      // insert riders without last comma
      await QUERIES.CREATE_RIDERS(insertQuery.slice(0, -1));

      res.json({ message: "Event creatied successfully" });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Event creation failed" });
    }
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
    res.json(!!(await QUERIES.VERIFY_EVENT_PASSWORD(event_id, password))[0]);
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
