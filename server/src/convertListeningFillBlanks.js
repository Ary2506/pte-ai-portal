import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Converts any remaining listening question still on the old "fill-blanks" type to
// "fill-blanks-typed", so it is reachable again.
//
//   node src/convertListeningFillBlanks.js [--write]
//
// Listening's Fill in the Blanks became its own type when it turned out the shared name was
// routing a many-blank, free-text exercise to scoreSingleChoice. The 65 bundled questions moved
// across with it, but a question seeded separately kept the old type — leaving it active in the
// bank yet absent from the menu, because the listening section now only offers the typed variant.
//
// The exercise changes with it: the student types the word instead of choosing from four options.
// That is the behaviour of every other listening Fill in the Blanks question here, and matching
// them is the point — an options dropdown under the same menu entry would be the odd one out.
// The distractors are dropped, since a typed answer has nothing to distract from.

function buildTypedShape(question) {
  const parts = String(question.passage || "").split("____");
  if (parts.length < 2) return { error: "passage has no ____ blank to convert" };

  // The answer index points into options; that option's text becomes the typed answer key.
  const correctWord = Array.isArray(question.options) ? question.options[Number(question.answer)] : undefined;
  if (typeof correctWord !== "string" || !correctWord.trim()) {
    return { error: `answer index ${question.answer} does not resolve to an option` };
  }
  if (parts.length > 2) {
    return { error: `passage has ${parts.length - 1} blanks but only one answer index to convert` };
  }

  const content = [];
  if (parts[0]) content.push({ type: "text", value: parts[0] });
  content.push({ type: "blank", answer: correctWord });
  if (parts[1]) content.push({ type: "text", value: parts[1] });

  return {
    doc: {
      type: "fill-blanks-typed",
      prompt: "Listen to the recording and type the missing word.",
      content,
      answer: [correctWord],
      maxScore: 1,
      active: true
    }
  };
}

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();

  const rows = await Question.find({ section: "listening", type: "fill-blanks" }).lean();
  if (!rows.length) {
    console.log("No listening questions left on the old fill-blanks type.");
    process.exit(0);
  }

  const planned = [];
  for (const row of rows) {
    const { doc, error } = buildTypedShape(row);
    if (error) {
      console.error(`  SKIPPED  "${row.title}" — ${error}`);
      continue;
    }
    // Checked before writing, so a conversion that would simply fail validation and be
    // deactivated again is caught here rather than after the fact.
    const { errors } = validateAndNormalizeQuestion({ ...row, ...doc, options: undefined });
    if (errors.length) {
      console.error(`  SKIPPED  "${row.title}" — would not validate: ${errors.join("; ")}`);
      continue;
    }
    planned.push({ _id: row._id, title: row.title, doc });
    console.log(`  "${row.title}"`);
    console.log(`     passage : ${row.passage}`);
    console.log(`     typed answer: ${JSON.stringify(doc.answer)}  (was option index ${row.answer} of ${JSON.stringify(row.options)})`);
  }

  console.log(`\n${rows.length} on the old type, ${planned.length} convertible`);
  if (!write) {
    console.log("\nDry run. Re-run with --write to convert.");
    process.exit(0);
  }

  for (const p of planned) {
    await Question.updateOne({ _id: p._id }, { $set: p.doc, $unset: { options: "" } });
  }
  console.log(`\nconverted ${planned.length} to fill-blanks-typed`);
  console.log(`listening fill-blanks-typed now: ${await Question.countDocuments({ section: "listening", type: "fill-blanks-typed", active: true })} active`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Conversion failed:", error.message);
    process.exit(1);
  });
}
