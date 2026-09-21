import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Phase 18 — an original, hand-written starter question bank. Every prompt/passage/sentence here
// was composed for this project; none is copied from any commercial or third-party question bank.
// Deliberately covers only task types that need no pre-existing audio/image (Read Aloud and
// Answer Short Question are read/spoken by the student themselves; the rest are pure text) — see
// Phase 18's plan for why the six media-dependent types are handled separately.
//
// Unlike seed.js's seedQuestions() (a one-shot, count===0-gated function that can never run again
// against a database that already has documents — this one already does), this seeder is
// idempotent by design: it re-checks every candidate against both the database and the rest of
// this same batch via a normalized signature (type + prompt + passage + options + answer +
// imageUrl + audioUrl) before inserting, and re-validates every candidate through the exact same
// validateAndNormalizeQuestion() the admin API itself uses, so nothing invalid can ever be seeded.
// Safe to import and call on every server start (see the in-process re-entrancy guard below for
// what "safe" does and doesn't cover).

function normalizeText(s) {
  return (s ?? "").toString().toLowerCase().trim().replace(/\s+/g, " ");
}
function normalizeAnswer(a) {
  if (Array.isArray(a)) return JSON.stringify([...a].sort((x, y) => x - y));
  if (typeof a === "number") return String(a);
  return normalizeText(a);
}
function normalizeOptions(options) {
  // For reorder/MCQ/fill-blanks, the distinguishing content is often the option text itself
  // (e.g. two reorder questions can share the same generic prompt and the same answer-index
  // pattern while shuffling completely different sentences) — so options must be part of the
  // signature, not just prompt/passage/answer.
  return Array.isArray(options) ? options.map(normalizeText).join("|") : "";
}
function signature(q) {
  // imageUrl/audioUrl matter too: Describe Image, Repeat Sentence, and Summarize Spoken Text all
  // reuse the exact same boilerplate instruction as their `prompt` across every question of that
  // type — the media file is the only thing that actually distinguishes one from another.
  return [
    q.type, normalizeText(q.prompt), normalizeText(q.passage), normalizeOptions(q.options),
    normalizeAnswer(q.answer), normalizeText(q.imageUrl), normalizeText(q.audioUrl)
  ].join("::");
}

// ---------------------------------------------------------------------------
// SPEAKING — Read Aloud (20). No audio needed: the student reads this text aloud themselves.
// ---------------------------------------------------------------------------
const readAloud = [
  ["Many people enjoy walking in the park early in the morning because the air feels fresh and the streets are quiet.", "easy"],
  ["Public libraries offer free access to books, computers, and quiet spaces for people of all ages to study and relax.", "easy"],
  ["Drinking enough water throughout the day helps the body stay healthy and improves concentration during work or study.", "easy"],
  ["Local farmers markets allow shoppers to buy fresh fruits and vegetables directly from the people who grow them.", "easy"],
  ["Learning to cook simple meals at home can save money and encourage healthier eating habits over time.", "easy"],
  ["Community gardens give city residents a chance to grow their own vegetables even without a private yard.", "easy"],
  ["The invention of the printing press in the fifteenth century dramatically increased the speed at which knowledge could spread across Europe.", "medium"],
  ["Urban planners are increasingly designing cities around pedestrians and cyclists rather than prioritizing space for private vehicles.", "medium"],
  ["Regular physical exercise not only strengthens the body but has also been shown to improve memory and reduce stress levels.", "medium"],
  ["Migratory birds travel thousands of kilometers each year, relying on the position of the sun and the earth's magnetic field to navigate.", "medium"],
  ["Many universities now offer online courses that allow students to study at their own pace from anywhere in the world.", "medium"],
  ["The rise of remote work has changed how companies think about office space, commuting, and employee flexibility.", "medium"],
  ["Coral reefs support an extraordinary variety of marine life, even though they cover less than one percent of the ocean floor.", "medium"],
  ["Archaeologists recently uncovered pottery fragments that suggest the region was inhabited far earlier than previously believed.", "medium"],
  ["Renewable energy sources such as wind and solar power are becoming more affordable as technology continues to improve.", "medium"],
  ["Despite significant advances in artificial intelligence, researchers continue to debate the ethical implications of deploying autonomous decision-making systems in sensitive areas such as healthcare and criminal justice.", "hard"],
  ["The gradual acidification of ocean water, driven largely by rising carbon dioxide levels, poses a long-term threat to shell-forming organisms that form the foundation of many marine food chains.", "hard"],
  ["Economists remain divided over whether automation will ultimately create more employment opportunities than it eliminates, particularly in industries that rely heavily on repetitive manual labor.", "hard"],
  ["The preservation of endangered languages has become an urgent concern for linguists, who argue that each language extinction represents an irreplaceable loss of cultural and cognitive diversity.", "hard"],
  ["Historians continue to reassess the long-term economic consequences of early industrialization, weighing technological progress against the social disruption experienced by displaced agricultural workers.", "hard"]
].map(([prompt, difficulty], i) => ({
  section: "speaking", type: "read-aloud", title: `Read Aloud ${i + 1}`, prompt, difficulty
}));

// ---------------------------------------------------------------------------
// SUPERSEDED — do not add back to PHASE18_TEXT_ONLY_CANDIDATES. This was the original 20-question
// Answer Short Question set (text prompt only, no answer key, no audio). The client later
// replaced Answer Short Question's entire content with 15 new questions that each carry a real
// answer key and a client-supplied audio clip (see clientAnswerShortQuestion below), and the old
// 21 records (these 20 plus 1 pre-existing one from seed.js) were deliberately deleted from the
// database. Kept here only as a historical record — pulling it back into
// PHASE18_TEXT_ONLY_CANDIDATES would let the idempotent seeder silently re-insert these 20 stale
// questions on a future server restart (the same mistake already made and fixed twice this
// project — see the SUPERSEDED comments above `clientDescribeImage` and `writeEmail`).
// ---------------------------------------------------------------------------
const answerShortQuestion = [
  ["What do we call a place where books are borrowed and read for free?", "easy"],
  ["What is the frozen form of water called?", "easy"],
  ["What do you call the meal eaten in the middle of the day?", "easy"],
  ["What instrument is commonly used to measure temperature?", "easy"],
  ["What do we call a person who teaches students in a school?", "easy"],
  ["What is the star at the center of our solar system called?", "easy"],
  ["What term describes a business owned and run by a single person?", "medium"],
  ["What do we call the study of the past through physical remains?", "medium"],
  ["What is the name for money paid regularly to rent a property?", "medium"],
  ["What term refers to a country's total economic output in a year?", "medium"],
  ["What do we call a doctor who specializes in treating children?", "medium"],
  ["What is the name for the layer of gases surrounding the Earth?", "medium"],
  ["What do we call a written agreement that is legally binding?", "medium"],
  ["What term describes the process plants use to convert sunlight into energy?", "medium"],
  ["What do we call a place where scientific experiments are conducted?", "medium"],
  ["What term describes a market structure dominated by a single seller?", "hard"],
  ["What is the name for the legal process of formally accusing someone of a crime?", "hard"],
  ["What term refers to the gradual wearing away of soil by wind or water?", "hard"],
  ["What do we call a shared cultural belief passed from one generation to the next without being written down?", "hard"],
  ["What is the term for a government system in which power is divided between a central authority and regional units?", "hard"]
].map(([prompt, difficulty], i) => ({
  section: "speaking", type: "answer-short-question", title: `Answer Short Question ${i + 1}`, prompt, difficulty
}));

// ---------------------------------------------------------------------------
// SUPERSEDED — do not add back to PHASE18_TEXT_ONLY_CANDIDATES. This was the original 15-passage
// Summarize Written Text set. The client replaced Summarize Written Text's entire content with 7
// new passages of their own (see clientSWT below), and these 15 plus the 1 pre-existing one from
// seed.js were deliberately deleted from the database. Kept here only as a historical record — see
// the SUPERSEDED comments above `clientDescribeImage`, `writeEmail`, and `answerShortQuestion` for
// the same pattern and why it matters: pulling this back into the active candidates would let the
// idempotent seeder silently re-insert these 15 stale questions on a future server restart.
// ---------------------------------------------------------------------------
const swtPrompt = "Write one sentence summarizing the passage in 5–75 words.";
const swt = [
  ["Many cities now provide separate bins for paper, plastic, and glass to make recycling easier for residents. Studies show that when recycling is convenient, participation rates increase significantly. However, contamination remains a common problem, as people sometimes place non-recyclable items into recycling bins, which can ruin an entire batch of otherwise recyclable material. Local governments are responding by offering clearer labeling and public education campaigns to reduce mistakes and improve overall recycling efficiency.", "easy"],
  ["Sleep plays a crucial role in maintaining both physical and mental health. During deep sleep, the body repairs tissue and consolidates memories formed during the day. Experts generally recommend that adults get between seven and nine hours of sleep each night, yet many people regularly sleep less due to work demands or screen use before bed. Chronic sleep deprivation has been linked to reduced concentration, weakened immune function, and a higher risk of several long-term health conditions.", "easy"],
  ["Public transportation systems help reduce traffic congestion and air pollution in densely populated cities. Buses, trains, and subways allow large numbers of people to travel efficiently without each person needing a private vehicle. Despite these benefits, many transit systems struggle with underfunding, leading to overcrowding, delays, and outdated infrastructure. City planners argue that consistent investment in public transport is essential not only for environmental reasons but also for improving overall quality of life in urban areas.", "easy"],
  ["Reading for pleasure has been shown to improve vocabulary, concentration, and empathy in both children and adults. Despite these benefits, surveys suggest that fewer people are reading books regularly, as smartphones and streaming services increasingly compete for free time. Educators worry that this decline could affect literacy rates over the long term. Some schools have responded by introducing dedicated reading periods during the school day to encourage students to build a lasting reading habit.", "easy"],
  ["Cities tend to be significantly warmer than surrounding rural areas, a phenomenon known as the urban heat island effect. This occurs because concrete, asphalt, and buildings absorb and retain heat far more effectively than natural landscapes such as forests or fields. The effect is intensified by the lack of vegetation and the heat generated by vehicles and air conditioning systems. Urban planners are exploring solutions such as green roofs, increased tree cover, and reflective building materials to help lower city temperatures.", "medium"],
  ["The rise of digital platforms has enabled a growing number of workers to pursue freelance careers rather than traditional full-time employment. This shift offers greater flexibility, allowing individuals to set their own schedules and work from virtually anywhere. However, freelancers often lack access to benefits such as health insurance and retirement savings plans, which are typically provided by employers. As the freelance economy continues to expand, policymakers are debating how existing labor laws should adapt to protect independent workers.", "medium"],
  ["Microplastics, tiny fragments of plastic less than five millimeters in size, have been detected in oceans, rivers, and even drinking water around the world. These particles originate from sources such as degraded packaging, synthetic clothing fibers, and cosmetic products. Because microplastics are so small, they are difficult to filter out of water supplies and can be ingested by marine organisms, potentially entering the food chain. Researchers are still investigating the long-term effects of microplastic exposure on both wildlife and human health.", "medium"],
  ["Standardized testing has long been used as a tool to measure student achievement and compare performance across schools. Supporters argue that these tests provide an objective, consistent way to evaluate learning outcomes. Critics, however, contend that standardized tests often fail to capture creativity, critical thinking, and other important skills, while placing excessive pressure on students. Some education systems have begun incorporating alternative assessment methods, such as project-based evaluations, to provide a more well-rounded picture of student ability.", "medium"],
  ["Bee populations play an essential role in pollinating crops that make up a significant portion of the global food supply. In recent decades, however, beekeepers in many regions have reported unusually high losses of honeybee colonies, a phenomenon partly attributed to pesticide exposure, habitat loss, and disease. Because so much agriculture depends on pollination, scientists warn that continued declines in bee populations could have serious consequences for food production. Researchers are now working to identify sustainable farming practices that better protect pollinator health.", "medium"],
  ["Telemedicine, which allows patients to consult doctors remotely through video calls or phone consultations, has expanded rapidly in recent years. This approach offers significant advantages for people living in rural areas who might otherwise travel long distances to see a specialist. It also reduces the burden on crowded hospital waiting rooms for non-emergency consultations. Nevertheless, telemedicine is not suitable for every situation, since some conditions require physical examination or diagnostic equipment that cannot be replicated remotely.", "medium"],
  ["Working night shifts can disrupt the body's natural circadian rhythm, leading to difficulties with sleep, digestion, and mood regulation. Employees in industries such as healthcare, manufacturing, and transportation often work overnight to maintain continuous operations. Research suggests that long-term night shift work is associated with an increased risk of certain chronic health conditions. Some employers have begun adjusting scheduling practices, such as limiting consecutive night shifts, in an effort to reduce the negative health effects on their workers.", "medium"],
  ["Central banks influence national economies primarily by adjusting interest rates, a tool used to either encourage or restrain borrowing and spending. When inflation rises too quickly, a central bank may raise interest rates to cool economic activity, though this can also slow job growth and increase borrowing costs for consumers and businesses alike. Conversely, lowering interest rates during periods of economic weakness can stimulate spending but risks fueling future inflation. Balancing these competing pressures remains one of the most challenging aspects of monetary policy.", "hard"],
  ["The growing popularity of consumer genetic testing services has raised significant privacy concerns among researchers and policymakers. When individuals submit DNA samples for ancestry or health information, they often unknowingly share genetic data that could reveal information about biological relatives who never consented to testing. Additionally, questions remain about how companies store, sell, or share this sensitive data with third parties, including insurers or law enforcement agencies. As genetic testing becomes more widespread, regulators face increasing pressure to establish clearer legal protections.", "hard"],
  ["Agricultural soil degradation, caused by factors such as overuse of chemical fertilizers, deforestation, and intensive monoculture farming, poses a growing threat to global food security. Degraded soil loses its capacity to retain water and essential nutrients, ultimately reducing crop yields over time. Restoring damaged soil is a slow process that often requires shifting to more sustainable farming techniques, such as crop rotation and reduced tillage. Given the scale of land already affected worldwide, many agricultural scientists argue that soil conservation deserves far greater policy attention.", "hard"],
  ["Judicial independence, the principle that courts should be free from political interference, is widely regarded as essential to maintaining the rule of law in democratic societies. When judges can be pressured or removed by political leaders for unfavorable rulings, public confidence in the fairness of legal proceedings tends to erode. Constitutional safeguards, such as fixed judicial terms and protections against arbitrary dismissal, are commonly used to preserve this independence. Nonetheless, debates continue over how much authority other branches of government should retain over judicial appointments.", "hard"]
].map(([passage, difficulty], i) => ({
  section: "writing", type: "swt", title: `Summarize Written Text ${i + 1}`, passage, prompt: swtPrompt, difficulty
}));

// ---------------------------------------------------------------------------
// WRITING — Essay (15).
// ---------------------------------------------------------------------------
const essay = [
  ["Some people prefer to live in a big city, while others prefer a small town. Discuss both views and give your own opinion.", "easy"],
  ["Many students choose to study alone, while others prefer to study in groups. Discuss the advantages of each approach and give your opinion.", "easy"],
  ["Some people think it is better to spend money as soon as it is earned. Others believe it is important to save for the future. Discuss both views and give your opinion.", "easy"],
  ["Some people believe that homework helps students learn better, while others think it causes unnecessary stress. Discuss both views and give your own opinion.", "medium"],
  ["Advances in technology have changed the way people communicate with one another. Discuss the positive and negative effects of this change.", "medium"],
  ["Some people think that governments should invest more in public transportation rather than building new roads. To what extent do you agree or disagree?", "medium"],
  ["Many companies now allow employees to work from home. Discuss the advantages and disadvantages of remote work for both employees and employers.", "medium"],
  ["Some people believe that success in life depends mainly on hard work, while others believe it depends mainly on luck. Discuss both views and give your opinion.", "medium"],
  ["Online shopping has become increasingly popular in recent years. Discuss the impact this has had on traditional retail stores and give your opinion on whether this trend is beneficial overall.", "medium"],
  ["Some educators argue that final exams are the best way to assess a student's knowledge, while others prefer continuous assessment through assignments and projects. Discuss both views and give your opinion.", "medium"],
  ["Some people argue that governments should prioritize economic growth over environmental protection, while others believe environmental protection should always come first. Discuss both perspectives and give your own opinion.", "hard"],
  ["As artificial intelligence becomes more capable, some believe it will eliminate more jobs than it creates, while others argue it will ultimately generate new forms of employment. Discuss both views and give your opinion.", "hard"],
  ["Some argue that social media companies should be held legally responsible for false information shared on their platforms, while others believe this would place an unreasonable burden on these companies. Discuss both views and give your own opinion.", "hard"],
  ["Some people believe that international trade agreements primarily benefit large corporations rather than ordinary workers. To what extent do you agree or disagree with this view?", "hard"],
  ["Some argue that a country's cultural identity is threatened by globalization, while others believe globalization enriches cultural diversity. Discuss both views and give your opinion.", "hard"]
].map(([prompt, difficulty], i) => ({
  section: "writing", type: "essay", title: `Write Essay ${i + 1}`, prompt, difficulty
}));

// ---------------------------------------------------------------------------
// READING — Multiple Choice Single (15).
// ---------------------------------------------------------------------------
const mcqSingle = [
  ["Bicycles are an efficient way to travel short distances in cities. They produce no emissions, require little maintenance, and help riders stay physically active.", "According to the passage, what is one benefit of bicycles?", ["They require frequent maintenance", "They produce no emissions", "They are expensive to buy", "They are only useful for long trips"], 1, "The passage states that bicycles produce no emissions.", "easy"],
  ["Public parks provide green space where city residents can exercise, relax, and socialize. Many parks also host community events throughout the year.", "What does the passage say about public parks?", ["They are only open in summer", "They host community events", "They are usually located outside cities", "They require an entrance fee"], 1, "The passage directly states that many parks host community events.", "easy"],
  ["Honey never spoils if it is stored properly, because its low moisture content and natural acidity prevent the growth of bacteria.", "Why does honey not spoil according to the passage?", ["It contains preservatives", "It has low moisture and natural acidity", "It is stored in sealed containers", "It is heated before packaging"], 1, "The passage explains that honey's low moisture content and natural acidity prevent bacterial growth.", "easy"],
  ["Volunteering at local charities allows people to gain new skills, meet others in their community, and contribute to causes they care about.", "According to the passage, what is one advantage of volunteering?", ["It guarantees future employment", "It allows people to gain new skills", "It is required by most employers", "It replaces the need for education"], 1, "The passage states that volunteering allows people to gain new skills.", "easy"],
  ["Although solar panels have a high initial installation cost, they can significantly reduce electricity bills over time and typically pay for themselves within a decade.", "What does the passage suggest about solar panels?", ["They have no installation cost", "They never reduce electricity bills", "They can pay for themselves over time", "They must be replaced every year"], 2, "The passage states that solar panels typically pay for themselves within a decade.", "medium"],
  ["The introduction of automated checkout systems in supermarkets has reduced waiting times for customers, though it has also decreased the number of available cashier positions.", "According to the passage, what is one consequence of automated checkout systems?", ["Longer waiting times for customers", "Fewer cashier positions available", "Higher prices for groceries", "Increased store operating hours"], 1, "The passage states that automated checkout has decreased the number of available cashier positions.", "medium"],
  ["Urban beekeeping has grown in popularity as city dwellers seek to support local pollinator populations, though some cities have introduced regulations limiting where hives can be placed.", "What does the passage indicate about urban beekeeping?", ["It is banned in all cities", "Some cities regulate where hives can be placed", "It has decreased in popularity", "It requires no local approval"], 1, "The passage mentions that some cities have introduced regulations limiting hive placement.", "medium"],
  ["Researchers found that employees who took short breaks every hour reported higher levels of focus and lower levels of fatigue compared to those who worked without interruption.", "According to the passage, what was the effect of taking short hourly breaks?", ["Higher fatigue and lower focus", "Higher focus and lower fatigue", "No measurable difference", "Increased need for sleep"], 1, "The passage states that employees who took breaks reported higher focus and lower fatigue.", "medium"],
  ["While electric vehicles produce no tailpipe emissions, the environmental impact of manufacturing their batteries has become a growing area of research and public debate.", "What is the passage mainly concerned with regarding electric vehicles?", ["Their high purchase price", "The environmental impact of battery manufacturing", "Their limited driving range", "Their lack of tailpipe emissions"], 1, "The passage focuses on the environmental impact of manufacturing electric vehicle batteries.", "medium"],
  ["Despite widespread awareness of the benefits of regular exercise, many adults report lacking the time to maintain a consistent fitness routine due to work and family obligations.", "According to the passage, why do many adults not exercise regularly?", ["They are unaware of the benefits", "They lack sufficient time", "They dislike physical activity", "They cannot afford gym memberships"], 1, "The passage states that many adults report lacking the time due to work and family obligations.", "medium"],
  ["Critics of standardized economic indicators such as GDP argue that these measures fail to capture non-market activities, environmental degradation, and inequality, prompting some economists to propose alternative metrics of national wellbeing.", "What is the main criticism of GDP mentioned in the passage?", ["It is too difficult to calculate", "It fails to capture factors like inequality and environmental harm", "It only measures manufacturing output", "It has been replaced in most countries"], 1, "The passage states that GDP fails to capture non-market activities, environmental degradation, and inequality.", "hard"],
  ["Although antibiotic resistance was once considered a distant concern, the overuse of antibiotics in both medicine and agriculture has accelerated the emergence of bacteria that no longer respond to common treatments.", "According to the passage, what has contributed to antibiotic resistance?", ["A shortage of new antibiotics", "The overuse of antibiotics in medicine and agriculture", "Reduced use of antibiotics worldwide", "Stricter regulation of pharmaceutical companies"], 1, "The passage attributes the rise in antibiotic resistance to overuse in medicine and agriculture.", "hard"],
  ["While globalization has expanded access to international markets for many businesses, it has also exposed domestic industries to intense competition, prompting some governments to reconsider protectionist trade policies.", "What has been one response to the effects of globalization described in the passage?", ["Governments have eliminated all trade barriers", "Some governments are reconsidering protectionist policies", "Domestic industries have stopped competing internationally", "International markets have become less accessible"], 1, "The passage states that some governments are reconsidering protectionist trade policies in response to intense competition.", "hard"],
  ["The concept of universal basic income, in which citizens receive a regular unconditional cash payment from the government, has gained renewed attention as automation threatens to displace workers in various industries.", "Why has universal basic income received renewed attention, according to the passage?", ["Because unemployment rates have decreased", "Because automation threatens to displace workers", "Because governments have excess funding", "Because most citizens already receive similar payments"], 1, "The passage links renewed interest in universal basic income to the threat of automation displacing workers.", "hard"],
  ["Legal scholars have long debated the extent to which freedom of expression should be limited to prevent the spread of misinformation, particularly on digital platforms where content can reach millions within hours.", "What debate does the passage describe?", ["Whether digital platforms should be banned", "How much freedom of expression should be limited to prevent misinformation", "Whether misinformation should be encouraged", "How quickly content spreads on television"], 1, "The passage describes a debate over limiting freedom of expression to prevent the spread of misinformation.", "hard"]
].map(([passage, prompt, options, answer, explanation, difficulty], i) => ({
  section: "reading", type: "mcq-single", title: `Reading MCQ Single ${i + 1}`, passage, prompt, options, answer, explanation, difficulty
}));

// ---------------------------------------------------------------------------
// READING — Multiple Choice Multiple (15).
// ---------------------------------------------------------------------------
const mcqMultiple = [
  [null, "Which of the following are commonly recommended ways to improve sleep quality? (Select all that apply.)", ["Maintaining a consistent sleep schedule", "Drinking coffee before bed", "Avoiding screens before bedtime", "Sleeping in a bright, noisy room"], [0, 2], "A consistent sleep schedule and avoiding screens before bed are both commonly recommended for better sleep quality.", "easy"],
  [null, "Which of the following are benefits of regular physical exercise? (Select all that apply.)", ["Improved cardiovascular health", "Increased risk of illness", "Better mood regulation", "Reduced muscle strength"], [0, 2], "Regular exercise is associated with improved cardiovascular health and better mood regulation.", "easy"],
  [null, "Which of the following are typically found in a public library? (Select all that apply.)", ["Books available for borrowing", "Computers for public use", "Private medical services", "Quiet study spaces"], [0, 1, 3], "Public libraries typically offer borrowable books, public computers, and quiet study spaces.", "easy"],
  ["Renewable energy sources, including solar, wind, and hydroelectric power, are increasingly used to reduce dependence on fossil fuels. However, each source has limitations related to cost, location, or consistency of supply.", "According to the passage, which of the following are mentioned as renewable energy sources? (Select all that apply.)", ["Solar power", "Coal", "Wind power", "Hydroelectric power"], [0, 2, 3], "The passage names solar, wind, and hydroelectric power as renewable energy sources; coal is not mentioned as renewable.", "medium"],
  ["Effective time management often involves setting clear priorities, breaking large tasks into smaller steps, and minimizing distractions during focused work periods.", "Which strategies for effective time management are mentioned in the passage? (Select all that apply.)", ["Setting clear priorities", "Working without breaks", "Breaking tasks into smaller steps", "Minimizing distractions"], [0, 2, 3], "The passage mentions setting priorities, breaking tasks into steps, and minimizing distractions — not working without breaks.", "medium"],
  ["Urban green spaces, such as parks and community gardens, can lower local temperatures, improve air quality, and provide habitats for wildlife within cities.", "According to the passage, which benefits do urban green spaces provide? (Select all that apply.)", ["Lower local temperatures", "Increased traffic congestion", "Improved air quality", "Habitats for wildlife"], [0, 2, 3], "The passage lists lower temperatures, improved air quality, and wildlife habitats as benefits of urban green spaces.", "medium"],
  ["A balanced diet typically includes a variety of fruits and vegetables, adequate protein intake, whole grains, and limited consumption of processed sugar.", "Which elements of a balanced diet are mentioned in the passage? (Select all that apply.)", ["A variety of fruits and vegetables", "High consumption of processed sugar", "Adequate protein intake", "Whole grains"], [0, 2, 3], "The passage recommends fruits and vegetables, adequate protein, and whole grains, while advising limited processed sugar.", "medium"],
  ["Companies that adopt flexible working hours often report higher employee satisfaction, reduced commuting stress, and improved retention rates, though coordinating team meetings can become more challenging.", "According to the passage, which outcomes are associated with flexible working hours? (Select all that apply.)", ["Higher employee satisfaction", "Reduced commuting stress", "Easier team meeting coordination", "Improved retention rates"], [0, 1, 3], "The passage links flexible hours to higher satisfaction, reduced commuting stress, and improved retention — but notes meeting coordination becomes harder, not easier.", "medium"],
  ["Museums increasingly use digital technology, including interactive displays, virtual tours, and mobile apps, to make exhibits more accessible to a wider audience.", "Which digital technologies are mentioned in the passage? (Select all that apply.)", ["Interactive displays", "Virtual tours", "Printed brochures", "Mobile apps"], [0, 1, 3], "The passage mentions interactive displays, virtual tours, and mobile apps — not printed brochures.", "medium"],
  ["Sustainable fishing practices include setting catch limits, protecting breeding grounds, and using selective fishing gear to reduce the capture of non-target species.", "According to the passage, which practices support sustainable fishing? (Select all that apply.)", ["Setting catch limits", "Protecting breeding grounds", "Using unrestricted fishing gear", "Using selective fishing gear"], [0, 1, 3], "The passage supports catch limits, protecting breeding grounds, and selective gear — not unrestricted gear.", "medium"],
  ["Behavioral economists have identified several cognitive biases that influence financial decision-making, including loss aversion, where losses feel more significant than equivalent gains, and anchoring, where people rely too heavily on initial information when making judgments.", "According to the passage, which cognitive biases are described? (Select all that apply.)", ["Loss aversion", "Anchoring", "Confirmation bias", "Overconfidence bias"], [0, 1], "The passage explicitly describes loss aversion and anchoring; confirmation bias and overconfidence bias are not mentioned.", "hard"],
  ["Climate adaptation strategies employed by coastal cities include constructing sea walls, restoring wetlands that absorb storm surges, and relocating critical infrastructure away from flood-prone areas.", "Which climate adaptation strategies are mentioned in the passage? (Select all that apply.)", ["Constructing sea walls", "Restoring wetlands", "Increasing fossil fuel subsidies", "Relocating critical infrastructure"], [0, 1, 3], "The passage names sea walls, wetland restoration, and relocating infrastructure — not fossil fuel subsidies.", "hard"],
  ["Central to modern epidemiology are concepts such as herd immunity, which occurs when a sufficient proportion of a population becomes immune to a disease, and the basic reproduction number, which estimates how many new infections a single case is likely to generate.", "According to the passage, which epidemiological concepts are described? (Select all that apply.)", ["Herd immunity", "Basic reproduction number", "Genetic drift", "Natural selection"], [0, 1], "The passage describes herd immunity and the basic reproduction number; genetic drift and natural selection are unrelated concepts not mentioned.", "hard"],
  ["Proponents of circular economy models advocate for designing products that can be repaired, reused, or recycled, thereby reducing reliance on continuous raw material extraction and minimizing landfill waste.", "According to the passage, what does a circular economy model emphasize? (Select all that apply.)", ["Designing products for repair and reuse", "Increasing raw material extraction", "Reducing landfill waste", "Recycling materials"], [0, 2, 3], "The passage emphasizes repair/reuse, reducing landfill waste, and recycling — not increasing raw material extraction.", "hard"],
  ["Constitutional systems that separate powers among the executive, legislative, and judicial branches are generally designed to prevent the concentration of authority in a single institution and to provide mechanisms of mutual oversight.", "According to the passage, what is the purpose of separating powers among branches of government? (Select all that apply.)", ["Preventing concentration of authority", "Eliminating the need for courts", "Providing mechanisms of mutual oversight", "Centralizing decision-making"], [0, 2], "The passage states the separation of powers prevents concentration of authority and provides mutual oversight — it does not eliminate courts or centralize decision-making.", "hard"]
].map(([passage, prompt, options, answer, explanation, difficulty], i) => ({
  section: "reading", type: "mcq-multiple", title: `Reading MCQ Multiple ${i + 1}`,
  ...(passage ? { passage } : {}), prompt, options, answer, explanation, difficulty
}));

// ---------------------------------------------------------------------------
// READING — Fill in the Blanks (15). `passage` carries the sentence with "____" as the blank.
// ---------------------------------------------------------------------------
const fillBlanks = [
  ["Regular exercise can help reduce stress and improve overall ____ health.", ["mental", "financial", "digital", "historical"], 0, "'Mental' correctly completes the sentence about the benefits of exercise on health.", "easy"],
  ["The museum's new exhibit will be open to the ____ starting next month.", ["public", "publicly", "publicity", "publicize"], 0, "The noun 'public' correctly fits after the definite article 'the'.", "easy"],
  ["She decided to ____ her savings account instead of spending the bonus immediately.", ["deposit", "deposited", "depositing", "deposits"], 0, "The base verb form 'deposit' correctly follows the modal-like structure 'decided to'.", "easy"],
  ["Many companies now offer flexible working hours to ____ employee satisfaction.", ["improve", "improving", "improved", "improves"], 0, "The base verb form 'improve' correctly follows the infinitive marker 'to'.", "easy"],
  ["The committee will ____ the proposal before making a final decision next week.", ["review", "reviewed", "reviewing", "reviews"], 0, "'Review' is the correct base form following the modal verb 'will'.", "easy"],
  ["Despite the heavy rainfall, the outdoor concert proceeded ____ scheduled.", ["as", "like", "so", "such"], 0, "'As scheduled' is the correct fixed expression meaning according to plan.", "medium"],
  ["The company's profits have grown steadily ____ the past three years.", ["over", "since", "during", "for"], 0, "'Over the past three years' is the correct preposition phrase for a duration ending now.", "medium"],
  ["The new policy will take effect ____ the beginning of next quarter.", ["at", "in", "on", "by"], 0, "'At the beginning of' is the standard collocation for referring to a starting point in time.", "medium"],
  ["The scientist's findings were later ____ by an independent research team.", ["confirmed", "confirming", "confirmation", "confirm"], 0, "The passive construction 'were confirmed' requires the past participle 'confirmed'.", "medium"],
  ["Employees are encouraged to raise concerns ____ their direct supervisor before escalating an issue.", ["with", "for", "about", "to"], 0, "'Raise a concern with someone' is the correct standard collocation.", "medium"],
  ["The negotiations broke down largely ____ of disagreements over trade tariffs.", ["because", "although", "despite", "unless"], 0, "'Because of' correctly introduces the reason the negotiations broke down.", "hard"],
  ["Had the board approved the merger earlier, the company ____ significant losses.", ["would have avoided", "will avoid", "avoids", "was avoiding"], 0, "The third conditional structure ('Had...approved') requires 'would have avoided' in the main clause.", "hard"],
  ["The report concludes that economic inequality, ____, could undermine long-term social stability.", ["if left unaddressed", "unless it was addressed", "even though not addressed", "despite being addressed"], 0, "'if left unaddressed' correctly forms a reduced conditional clause matching the sentence's meaning.", "hard"],
  ["The committee members, ____ opinions differed sharply, eventually reached a compromise.", ["whose", "which", "who", "that"], 0, "'Whose' correctly shows possession, referring to the committee members' opinions.", "hard"],
  ["Not until the final results were announced ____ the true scale of the victory.", ["did anyone realize", "anyone realized", "anyone did realize", "realized anyone"], 0, "The negative inversion after 'Not until...' requires the auxiliary-subject-verb order 'did anyone realize'.", "hard"]
].map(([passage, options, answer, explanation, difficulty], i) => ({
  section: "reading", type: "fill-blanks", title: `Fill in the Blanks ${i + 1}`,
  passage, prompt: "Choose the word or phrase that best completes the sentence.", options, answer, explanation, difficulty
}));

// ---------------------------------------------------------------------------
// READING — Reorder Paragraph (15). `answer` is the array of original-position indices in the
// correct reading order (matching the existing seed.js convention exactly).
// ---------------------------------------------------------------------------
const reorderFour = [
  [["First, lay two slices of bread on a clean plate.", "Next, spread a thin layer of butter on each slice.", "Then, add your choice of fillings between the slices.", "Finally, cut the sandwich in half and serve it."], "easy"],
  [["First, fill a small pot with soil.", "Next, make a shallow hole in the center.", "Then, place the seed into the hole and cover it gently.", "Finally, water the soil and place the pot in sunlight."], "easy"],
  [["First, the alarm clock rings at seven in the morning.", "Next, she gets out of bed and brushes her teeth.", "Then, she prepares a quick breakfast in the kitchen.", "Finally, she leaves the house to catch the morning bus."], "easy"],
  [["First, rinse the car with a hose to remove loose dirt.", "Next, apply soap using a soft sponge.", "Then, scrub the surface gently in circular motions.", "Finally, rinse off the soap and dry the car with a towel."], "easy"],
  [["First, search the library catalog for the book you want.", "Next, locate the book on the correct shelf.", "Then, bring the book to the front desk.", "Finally, show your library card to borrow the book."], "easy"],
  [["First, the founders identified a gap in the local market.", "Next, they wrote a detailed business plan to guide their strategy.", "After that, they secured a small loan to cover initial costs.", "Finally, they opened their store to the public last spring."], "medium"],
  [["First, the researcher observed an unusual pattern in the data.", "Next, she formed a hypothesis to explain the pattern.", "After that, she designed an experiment to test her hypothesis.", "Finally, she analyzed the results and published her findings."], "medium"],
  [["First, engineers surveyed the site to assess its condition.", "Next, the city council approved funding for the renovation.", "After that, construction crews began repairing the damaged road.", "Finally, the road reopened to traffic two months later."], "medium"],
  [["First, the author spent two years writing the manuscript.", "Next, she submitted the manuscript to several publishers.", "After that, an editor worked with her to revise the text.", "Finally, the finished book was released in bookstores nationwide."], "medium"],
  [["First, the organizers selected a theme for the conference.", "Next, they invited speakers with relevant expertise.", "After that, they promoted the event through social media.", "Finally, hundreds of attendees gathered for the two-day event."], "medium"],
  [["First, marine biologists surveyed the damaged reef.", "Next, they identified sections suitable for coral transplantation.", "After that, volunteers attached coral fragments to the reef structure.", "Finally, researchers monitored the reef's recovery over several years."], "medium"],
  [["First, the two companies began confidential merger discussions.", "Next, both boards reviewed the financial terms of the deal.", "After that, regulators approved the merger following an antitrust review.", "Finally, the merged company announced its new leadership structure."], "medium"]
];
const reorderFive = [
  [["First, a member of parliament proposed a new bill addressing data privacy.", "Next, the bill was debated extensively in committee sessions.", "After that, several amendments were made to address industry concerns.", "Then, the revised bill passed a full vote in parliament.", "Finally, the bill received royal assent and became law."], "hard"],
  [["First, researchers conducted laboratory tests to assess the drug's basic safety.", "Next, a small group of healthy volunteers received the drug in an initial trial.", "After that, a larger trial tested the drug's effectiveness among patients with the condition.", "Then, regulators reviewed the trial data for approval.", "Finally, the drug became available to the public following regulatory approval."], "hard"],
  [["First, early traders established informal paths between neighboring settlements.", "Next, these paths gradually became formal routes as trade increased.", "After that, merchants built rest stations along the routes to support long journeys.", "Then, local rulers began taxing goods transported along these routes.", "Finally, the routes evolved into a major network connecting distant regions."], "hard"]
];
const reorder = [
  ...reorderFour.map(([l, difficulty], i) => {
    const options = [l[1], l[3], l[0], l[2]]; // scrambled; answer maps back to l[0..3] in order
    return {
      section: "reading", type: "reorder", title: `Reorder Paragraph ${i + 1}`,
      prompt: "Arrange these sentences into the correct logical order.",
      options, answer: [2, 0, 3, 1],
      explanation: "The sentences form a clear first-next-then-finally sequence.", difficulty
    };
  }),
  ...reorderFive.map(([l, difficulty], i) => {
    const options = [l[1], l[4], l[0], l[3], l[2]]; // scrambled; answer maps back to l[0..4] in order
    return {
      section: "reading", type: "reorder", title: `Reorder Paragraph ${reorderFour.length + i + 1}`,
      prompt: "Arrange these sentences into the correct logical order.",
      options, answer: [2, 0, 4, 3, 1],
      explanation: "The sentences form a clear chronological sequence of events.", difficulty
    };
  })
];

const PHASE18_TEXT_ONLY_CANDIDATES = [
  ...readAloud, ...essay, ...mcqSingle, ...mcqMultiple, ...fillBlanks, ...reorder
];

// ---------------------------------------------------------------------------
// Media-bearing content (Phase 18, Option A) — original audio/images generated via the
// Higgsfield AI tools this session and reviewed for quality before use here. Every image is an
// original AI-generated infographic/diagram/scene (no copied charts or photos); every audio clip
// is original AI text-to-speech of hand-written sentences/passages above — none copied from any
// question bank or real broadcast.
//
// This batch is intentionally partial: it covers every media-dependent type at least once (so
// each type genuinely works end-to-end, media included) but stops short of the full ~105-item
// target because the workspace's AI-generation credit balance ran out mid-batch (this was
// confirmed live via the balance tool, not assumed). No placeholder/fake URLs were substituted
// for the remainder — those questions simply were not created. See the Phase 18 report for the
// exact shortfall and what a follow-up batch needs to cover.
// ---------------------------------------------------------------------------
const describeImagePrompt = "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.";
const describeImage = [
  ["Describe Image 1 — Rainfall Bar Chart", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190455_72c567e6-d7e4-4ff0-9668-23a6fe6885eb.png", "easy"],
  ["Describe Image 2 — Revenue Line Graph", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190455_8a63ff94-8259-4ed8-b58c-b8530d7349da.png", "medium"],
  ["Describe Image 3 — Household Budget Pie Chart", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190455_ad59413d-b8e3-4082-906b-5aeae9529a11.png", "easy"],
  ["Describe Image 4 — Water Cycle Diagram", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190455_b409f554-78da-4731-84cf-cfb125d29010.png", "medium"],
  ["Describe Image 5 — Farmers Market Scene", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190455_1e153b6d-f980-49ea-86e4-3be3131816ae.png", "easy"]
].map(([title, imageUrl, difficulty]) => ({
  section: "speaking", type: "describe-image", title, prompt: describeImagePrompt, imageUrl, difficulty
}));

const repeatSentencePrompt = "Listen to the sentence, then repeat it exactly as you hear it.";
const repeatSentence = [
  ["Repeat Sentence 1", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_c6ebc77d-ddf5-4fc5-ad70-8652bd73ec1c.wav", "easy"],
  ["Repeat Sentence 2", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190817_07188fdd-7dda-44ea-a1c3-e60dd2410850.wav", "easy"],
  ["Repeat Sentence 3", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190733_f5605eb2-1d67-4717-a118-3057461f7a7e.wav", "easy"],
  ["Repeat Sentence 4", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_8537e15a-c00a-4f16-916a-a6cbb7ebbb89.wav", "easy"],
  ["Repeat Sentence 5", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_946112c5-7981-4704-9086-904ab1545ff8.wav", "easy"]
].map(([title, audioUrl, difficulty]) => ({
  section: "speaking", type: "repeat-sentence", title, prompt: repeatSentencePrompt, audioUrl, difficulty
}));

const sstListeningPrompt = "Listen to the passage. Then, in 10 minutes, write a summary for someone who has not heard it. Your summary should be 50–70 words.";
const sstListening = [
  ["Summarize Spoken Text 1 — Bilingualism", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190733_830eb6f6-3d15-4637-9fa8-847a06267478.wav", "medium"],
  ["Summarize Spoken Text 2 — Postal Relay Systems", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190818_7d3b83ec-a5b3-46bc-a136-4e6db1ed14bd.wav", "medium"],
  ["Summarize Spoken Text 3 — Habit Formation", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_30c77ae9-1182-4578-8b83-6be10d84b783.wav", "medium"],
  ["Summarize Spoken Text 4 — Noise Pollution and Marine Life", "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_fa07e724-9196-4dc7-8c60-58ce96b60643.wav", "medium"]
].map(([title, audioUrl, difficulty]) => ({
  section: "listening", type: "summarize-spoken-text", title, prompt: sstListeningPrompt, audioUrl, difficulty
}));

const listeningMcqSingle = [
  {
    section: "listening", type: "mcq-single", title: "Listening MCQ Single 1 — Bike Lane Expansion",
    prompt: "What is the main purpose of the bike lane expansion, according to the talk?",
    options: ["To increase parking spaces downtown", "To reduce traffic congestion and encourage cycling", "To reduce city maintenance costs", "To attract more tourists downtown"],
    answer: 1, explanation: "The talk states the project aims to reduce traffic congestion and encourage residents to commute by bicycle.",
    audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260902_190553_1a4863cd-5843-4b51-82bc-a08adcd47ff5.wav",
    difficulty: "medium"
  }
];

const PHASE18_MEDIA_CANDIDATES = [...describeImage, ...repeatSentence, ...sstListening, ...listeningMcqSingle];

// ---------------------------------------------------------------------------
// Phase 20 — original, text-only content for the two new task types that need no media
// (Write Email, Fill in the Blanks Drag-and-Drop). The three remaining new types this phase adds
// (Respond to a Situation, Select Missing Word, Highlight Incorrect Words) all require audio and
// are deliberately left with zero seeded content here — see the Phase 20 report for why.
//
// SUPERSEDED (Write Email only, dragFill below is unaffected and still active) — the client
// replaced Write Email's entire question-based content with their own PDF of 12 sample emails,
// shown and downloaded as-is (see client/src/practice/WriteEmailPdf.jsx and
// client/public/writing-resources/write-email-samples.pdf). The write-email practice page now
// bypasses the DB-backed question flow entirely, and these 5 original prompts were deliberately
// deleted from the database. The `writeEmail` array is kept only as a historical record — it must
// stay out of PHASE18_ALL_CANDIDATES, or the idempotent seeder will silently re-insert these 5
// stale questions on the next server restart (exactly what happened once already with an earlier,
// similarly-superseded Describe Image batch — see the comment above `clientDescribeImage`).
// ---------------------------------------------------------------------------
const writeEmail = [
  ["You recently purchased a product online that arrived damaged. Write an email to the company's customer service team explaining the problem and requesting a replacement or refund.", "easy"],
  ["You are unable to attend a scheduled meeting at work due to a personal emergency. Write an email to your manager explaining the situation and requesting to reschedule.", "easy"],
  ["You would like to apply for a part-time position advertised by a local company. Write an email to the hiring manager introducing yourself and expressing your interest in the role.", "medium"],
  ["Your neighbor's frequent late-night noise has been disturbing your sleep. Write a polite email to your neighbor explaining the issue and asking them to be more considerate.", "medium"],
  ["You recently completed a course and would like to request a copy of your certificate, which you have not yet received. Write an email to the course administrator explaining your request.", "medium"]
].map(([prompt, difficulty], i) => ({
  section: "writing", type: "write-email", title: `Write Email ${i + 1}`, prompt, difficulty
}));

const dragFillPrompt = "Drag each word from the word bank into the correct blank.";
const dragFill = [
  ["Solar panels convert sunlight directly into ____ through a process called the photovoltaic effect, while wind turbines generate power by capturing the ____ energy of moving air.", ["electricity", "kinetic", "chemical", "static"], [0, 1], "easy"],
  ["Scientists begin by making an ____ about a phenomenon, then propose a testable ____ to explain it, and finally design an experiment to test their prediction.", ["observation", "hypothesis", "conclusion", "opinion"], [0, 1], "medium"],
  ["Many cities are investing in public ____ to reduce traffic congestion, while also expanding ____ space to improve air quality and resident wellbeing.", ["transportation", "green", "parking", "commercial"], [0, 1], "easy"],
  ["A balanced diet typically includes adequate ____ for muscle repair, along with sufficient ____ to provide the body with lasting energy throughout the day.", ["protein", "carbohydrates", "sugar", "caffeine"], [0, 1], "medium"],
  ["When demand for a product increases while supply remains limited, prices tend to ____; conversely, when supply exceeds demand, prices generally ____.", ["rise", "fall", "stabilize", "double"], [0, 1], "medium"]
].map(([passage, options, answer, difficulty], i) => ({
  section: "reading", type: "fill-blanks-dragdrop", title: `Fill in the Blanks Drag and Drop ${i + 1}`,
  prompt: dragFillPrompt, passage, options, answer, difficulty
}));

const PHASE20_TEXT_CANDIDATES = [...dragFill];

// ---------------------------------------------------------------------------
// Phase 23 — the client's own curated Read Aloud set (client-confirmed as content they have the
// rights to use). Replaces the Phase 18 batch as the *active* Read Aloud content — see
// deactivateOldReadAloud.oneoff.js (run once, then removed) for the one-time deactivation of the
// prior 21 questions this set replaces. Text is used exactly as supplied, unmodified.
//
// All confirmed by the client as content they have the rights to use, and all now activated —
// see activateReadAloudByTitle.oneoff.js (first batch) and the equivalent one-off run for this
// second batch.
// ---------------------------------------------------------------------------
const clientReadAloud = [
  ["Visit to Canada", "The best time to visit Canada is during fall months, when mild temperatures and vibrant fall foliage make scenic drives, hiking, and outdoor exploration especially enjoyable. Travel guides often highlight autumn — especially from late September through November — as a peak season for color changes in Ontario, Quebec, and other regions of the country.", "medium"],
  ["Community Gardening", "We bring together people, resources, and education to benefit lives and neighborhoods through community gardening. From our beginnings, American Community Gardening Association has encouraged networking among members to share community gardening information, experience, and best practices. We also offer formal educational opportunities, such as local and regional workshops, webinars, publications, and online resources.", "medium"],
  ["Smart Cooking", "You don't have to spend a lot of time in the kitchen on weekends, say nutrition experts and home chefs who promote smart cooking habits. The trend, which has taken off on social media and in lifestyle magazines this year, encourages simple meal prep, batch cooking, and the use of time-saving appliances to reduce stress.", "medium"],
  ["Parent Teacher Conferences", "Schools host parent teacher conferences four times a year and it is important for families to attend. This is your chance to meet with teachers and ask questions about your child's progress. It can be helpful to write down questions ahead of time.", "easy"],
  ["Enough Fluid", "Your body is nearly two-thirds water. And so it is really important that you consume enough fluid to stay hydrated and healthy. If you don't get enough fluid you may feel tired, get headaches, and not perform at your best.", "easy"],
  ["Antarctic", "The world's fifth largest continent: Antarctica is almost entirely covered by ice 2000 meters thick. The area sustains varied wildlife including seals, whales, and penguins. The Antarctic treaty signed in 1959 and enforced since 1961 provides for international governance of Antarctica.", "easy"],
  ["Soft Drink", "The main production of soft drink was started in 1830's. Since then, from those experimental beginning, there was an evolution until in 1781 when the world's first cola-flavored beverage was introduced. These drinks were called soft drinks, only to separate them from hard alcoholic drinks. Today, soft drink is more favorite refreshment drink than tea, coffee, juice, etc.", "medium"],
  ["Liverpool", "Located at the heart of two world famous cities, Liverpool and London, Liverpool's excellence in teaching, learning and research, first-class facilities and outstanding support places the university in the top 1% of universities worldwide. The University of Liverpool will provide you with an inspiring student experience, in a diverse international community.", "easy"],
  ["Source of Funding", "A study found that the research funded by the soft drinks industry had different results from research funded by other sources and went on to suggest that they may have been biased by the research itself. The whole point of the scientific methods is to ensure the research results are not influenced by the source of funding.", "hard"],
  ["Girls v.s. Boys", "Teenage girls are continuing to outperform boys in English while the gender gap in achievements in math and science has almost disappeared. The figures show that last year 80% of 14-year-old girls reached at least the expected level 5 in English, compared with 65% of boys. But in math, the girls are just 1% ahead of boys, while in science the difference is 2%.", "medium"],
  ["Elephant", "The elephant is the largest living land mammal. During evolution, its skeleton has greatly altered from the usual mammal, designed for two main reasons. One is to cope with the great weight of huge grinding cheek teeth and elongated tusk, making the skull particularly massive. The other is to support the enormous bulk of such a huge body.", "medium"],
  ["Fast Food", "Hundreds of millions of American people eat fast food every day without giving it too much thought, unaware of the subtle and not so subtle ramifications of their purchases. They just grab their tray off the counter, find a table, take a seat, unwrap the paper, and dig in. The whole experience is transitory and soon forgotten.", "medium"],
  ["Language Appearance", "It seems that language appeared from nowhere since no other species has anything resembling human language. However, other animals do possess basic systems for perceiving and producing sounds that enable them to communicate. These systems may have been in place before the appearance of language.", "hard"],
  ["Studying Topics", "In classes, your teachers will talk about topics that you are studying. The information that they provide will be important to know when you take tests. You must be able to take good written notes from what your teachers say.", "easy"],
  ["Yellow", "Yellow is considered as the most optimistic color. Yet surprisingly, people lose their tempers more often in yellow rooms and babies cry more in them. The reason may be that yellow is the hardest color for eyes to take in. So it can be overpowering if overused.", "medium"]
].map(([title, prompt, difficulty]) => ({
  section: "speaking", type: "read-aloud", title, prompt, difficulty
}));

const PHASE23_TEXT_CANDIDATES = [...clientReadAloud];

// ---------------------------------------------------------------------------
// SUPERSEDED — do not add back to PHASE18_ALL_CANDIDATES. This was the original client-supplied
// Describe Image batch (8, describe_image_01.jpg..08.jpg). The client later replaced this entire
// Describe Image set with 41 individually cropped questions (bar/flow/line/map/pic/pie/table +
// the 8-in-one set, see client/public/question-images/describe-image/*.jpg) and the old 14
// records (these 8 plus 6 pre-existing ones) were deliberately deleted from the database. The
// array is kept here only as a historical record of what was once seeded — it must stay out of
// PHASE18_ALL_CANDIDATES, or the idempotent seeder will silently re-insert these 8 stale
// questions the next time the server restarts (which is exactly what happened once already).
// ---------------------------------------------------------------------------
const describeImagePrompt2 = "Look at the image below. In 25 seconds, please speak into the microphone and describe in detail what the image is showing.";
const clientDescribeImage = [
  ["Describe Image 6", "/question-images/describe-image/describe_image_01.jpg", "The following graph gives information about the average rainfall in inches in New York, Dallas, Phoenix, and Honolulu. As we can see from the graph, New York has the largest amount, 47.25 inches, next to Dallas, 33.70 inches. When we look at the other two cities, they are significantly smaller than the first two, with Phoenix amounting to 7.66 and Honolulu, 22.02. In conclusion, the average rainfalls in the cities are largely affected by geographic locations."],
  ["Describe Image 7", "/question-images/describe-image/describe_image_02.jpg", "The following picture gives information about instant coffee. You can see from this graph that hot water is poured from a kettle into the cup. What's more, a packet of instant coffee is added into the cup. Then, the third step is that creamer from a sachet is poured into the cup. After that, sugar is added and a spoon stirs the coffee until everything dissolves evenly. Finally, the coffee is ready and is enjoyed by drinking. To sum up, this graph tells about how coffee is processed."],
  ["Describe Image 8", "/question-images/describe-image/describe_image_03.jpg", "The following picture gives information about shopping in a stationery store. In the left half of the picture we can see a white woman in pink sweater with her daughter in the arms. The mother and the daughter look at each other with smiles in their faces. And the daughter holds a new bag in the hand. In the right half of the picture the daughter carries the bag on the back. Also, she holds six colorful pencils in the hands in front of the chest. To sum up, this picture tells about how the two shop for stationery."],
  ["Describe Image 9", "/question-images/describe-image/describe_image_04.jpg", "The following picture gives information about the number of US households keeping pets. According to the graph, I notice cats are forty-two point seven million. The value of dogs is higher, about sixty-three point four million. From the bar chart, we can see the highest one is for total, eighty-four point nine million. The lowest number is for horses and saltwater fish, which is one point six million. In the bar chart there are also other items, including freshwater fish and birds. In conclusion, this bar chart tells about US households keeping pets."],
  ["Describe Image 10", "/question-images/describe-image/describe_image_05.jpg", "The following picture gives information about the numbers of cat owners in different countries. According to the graph, I notice the percentage of Italy is forty percent. The value of the United States is higher, about forty-three percent. From the bar chart, we can see the highest one is in Russia, fifty-nine percent. The lowest number is South Korea, which is nine percent. In the bar chart there are also other countries, including Turkey and Germany. In conclusion, this bar chart tells about cat owners in countries."],
  ["Describe Image 11", "/question-images/describe-image/describe_image_06.jpg", "This pie chart gives information about travel time to work in Ontario. From the picture we can see thirty to forty-four minutes, the value is twenty-one percent. In less than fifteen minutes the proportion is higher, which is twenty-four percent. The highest number is fifteen to twenty-nine minutes, around thirty-two percent. And the lowest percentage is in forty-five to fifty-nine minutes, just 10 percent. To sum up, the graph tells about travel time to work in Ontario."],
  ["Describe Image 12", "/question-images/describe-image/describe_image_07.jpg", "This bar chart tells about how many tourists visit Canada each year. From the picture we can see, in 2022 the number is twelve point eight million. In 2023 the value is higher, eighteen point three million. And the greatest quantity is in 2019, which is twenty-two point one million. But the smallest one is in 2020, only three million, followed by that in 2021, just three point one million. To sum up, the picture tells only about the numbers of visitors to Canada."],
  ["Describe Image 13", "/question-images/describe-image/describe_image_08.jpg", "This chart gives information about average weekly household spending on goods and services. From the picture we can see transportation, the value is nearly two hundred. In food and non-alcoholic beverages the number is higher, which is two hundred and forty. The highest point is in current housing costs, around two hundred and seventy. And the lowest one is in tobacco products, just twenty. Other items include personal care and alcoholic beverages. To sum up, the graph tells about weekly household spending."]
].map(([title, imageUrl, answer]) => ({
  section: "speaking", type: "describe-image", title, prompt: describeImagePrompt2, imageUrl, answer, difficulty: "medium"
}));

const CLIENT_DESCRIBE_IMAGE_CANDIDATES = [...clientDescribeImage];

// ---------------------------------------------------------------------------
// Client-supplied "Core P" Describe Image batch (8) — the individual sub-images cropped from the
// client's "Core p 8 qus.jpeg" source file (see client/public/question-images/describe-image/
// coreq8_01..08.jpg). Deliberately left WITHOUT a `category` value, on purpose: this project's
// "My Type" category filter (client/src/practice/Practice.jsx's QuestionListView) already treats
// an uncategorized question as visible only under "All", never under any specific category tab —
// so no schema change or new filtering logic was needed, just omitting `category` here. These 8
// therefore appear in All Describe Image (making the active total 33 curated + 8 = 41) but never
// under Bar/Flow/Pie/Line/Map/Table/Pic, even though several overlap in topic with a curated
// question from the dedicated per-type source files (e.g. "Instant Coffee" also exists as a Flow
// question, "Commuting Time" also exists as a Pie question) — kept anyway, per explicit
// instruction not to deduplicate this group against the curated set. `sourceGroup: "core-p"` is
// non-functional metadata (nothing filters on it) kept only so this batch stays identifiable as a
// deliberate group, distinct from any other stray uncategorized content that might exist later.
// ---------------------------------------------------------------------------
const clientCoreP = [
  ["Average Rainfall", "coreq8_01", "The bar chart shows the average rainfall in inches in New York, Dallas, Phoenix, and Honolulu. New York has the highest amount, 47.25 inches, followed by Dallas at 33.70. Phoenix has the lowest, 7.66 inches, while Honolulu receives 22.02 inches. Overall, the chart shows that average rainfall varies significantly across these cities."],
  ["Instant Coffee", "coreq8_02", "The picture shows the steps for making a cup of instant coffee. First, hot water is poured into a cup. Next, a sachet of instant coffee is added, followed by creamer from a sachet. Then, sugar is added and the mixture is stirred well until it dissolves. Finally, the coffee is ready to drink and can be enjoyed."],
  ["Stationery Shopping", "coreq8_03", "The pictures show a mother and her daughter shopping in a stationery store. In the left image, the mother looks at her daughter with a smile while the daughter holds a new bag. In the right image, the daughter carries the bag on her back and holds six colorful pencils in her hands. Overall, the pictures show the two happily shopping for stationery items."],
  ["Pet Ownership", "coreq8_04", "The bar chart shows the number of U.S. households keeping pets. In total, 84.9 million households have pets. Dogs are the most common at 63.4 million, followed by cats at 42.7 million. Freshwater fish and birds are much lower at 11.5 million and 5.7 million. Horses and saltwater fish are the least common at 1.6 million each. Overall, dogs and cats are far more popular than the other types of pets."],
  ["Cat Owners", "coreq8_05", "The bar chart shows the percentage of people who own a cat in different countries. Russia has the highest percentage at 59%, followed by the United States at 43% and Argentina at 41%. The lowest percentage is in South Korea at 9%. Other countries, such as Italy, France, Vietnam and Brazil, have moderate percentages. Overall, the chart shows that cat ownership varies widely across countries."],
  ["Commuting Time", "coreq8_06", "The pie chart shows the travel time to work in Ontario in 2016. The largest proportion is 15–29 minutes at 32.2%, followed by less than 15 minutes at 24.0% and 30–44 minutes at 21.3%. About 10.1% of people travel for 45–59 minutes, while 12.4% take more than 1 hour. Overall, most people spend less than 30 minutes commuting."],
  ["Canada Visitors", "coreq8_07", "The bar chart shows how many tourists visit Canada each year. The highest number is in 2019 at 22.1 million, followed by 2018 and 2017. The lowest number is in 2020 at only 3.0 million, with 2021 slightly higher at 3.1 million. The number then increased to 12.8 million in 2022 and 18.3 million in 2023. Overall, the chart shows a sharp drop in 2020 and 2021, followed by a recovery in 2022 and 2023."],
  ["Weekly Spending", "coreq8_08", "The chart shows average weekly household spending on goods and services. Current housing costs are the highest at about $270, followed by food and non-alcoholic beverages at $240 and transport at $200. The lowest spending is on tobacco products at $10, with personal care at $20 and alcoholic beverages at $40. Overall, households spend the most on housing and the least on tobacco products."]
].map(([title, file, answer]) => ({
  section: "speaking", type: "describe-image", title, prompt: describeImagePrompt2,
  imageUrl: `/question-images/describe-image/${file}.jpg`, answer, sourceGroup: "core-p", difficulty: "medium"
}));

const CLIENT_CORE_P_CANDIDATES = [...clientCoreP];

// ---------------------------------------------------------------------------
// Client-supplied Summarize Written Text batch (7) — replaces the old 15-passage set (see the
// SUPERSEDED comment above `swtPrompt`). Passage text is used exactly as supplied by the client's
// PDF, unmodified. Each source passage carried its own reference number (e.g. "111 — Microloans")
// which reads as a word count, not a sequence index — dropped from `title` since it isn't part of
// the passage's identity, keeping just the descriptive topic name.
// ---------------------------------------------------------------------------
const clientSwt = [
  ["Microloans", "Microloans are small-scale loans created to help individuals and small businesses that may not have access to conventional bank financing. They are commonly offered through microfinance initiatives that seek to improve financial inclusion and encourage economic development. Borrowers may use these funds to launch a business, buy equipment, or meet short-term operating expenses. A major benefit is that microloans are often easier to obtain than larger bank loans, particularly for people with limited credit records or collateral. The amounts are usually modest, ranging from several hundred to a few thousand dollars. Even so, these loans can have a meaningful effect by helping small businesses expand and become financially sustainable. Before choosing a microloan, borrowers should consider their funding requirements, ability to repay, and how the money will contribute to their business objectives. Overall, microloans provide entrepreneurs with accessible funding for relatively small but important financial needs."],
  ["Outdoor Games", "Outdoor games play an important role in children's physical and psychological growth. Activities such as soccer, tag, and hide-and-seek help young people develop coordination, motor abilities, physical fitness, and strength. Playing outside also gives children opportunities to interact with others, practice teamwork and communication, and understand cooperation and fair play. In addition, outdoor environments encourage exploration and imagination while exposing children to fresh air and natural sunlight. Frequent physical activity can help lower the likelihood of obesity and other health problems and can encourage an active lifestyle. With children spending increasing amounts of time using digital devices, outdoor games are particularly useful for reducing sedentary behavior and encouraging healthier daily routines."],
  ["Preschool Education Programs", "A recent policy proposal recommends cutting financial support for preschool education and redirecting some of those resources toward primary and secondary schools. Supporters argue that these stages face urgent problems, including crowded classrooms and shortages of teachers, and therefore deserve additional funding. Some also believe that parents should have a greater role in providing education during early childhood instead of depending heavily on publicly funded programs.\n\nCritics, however, stress that preschool education establishes an important foundation for children's later academic and social development. Research indicates that children who receive high-quality early education often achieve stronger results in school, are more likely to complete high school, and may have greater earning opportunities later in life. Critics further argue that funding cuts could have a greater effect on low-income families, who may depend on affordable preschool services, thereby widening existing educational inequalities.\n\nEarly childhood programs also assist working parents by providing reliable care and learning opportunities, allowing them to remain employed. The discussion therefore centers on whether redirecting limited education funds would provide greater benefits than the possible long-term effects of reducing investment in preschool education."],
  ["Microloan", "Business microloans have become an important means of helping small enterprises develop and encouraging economic progress, especially in developing nations. These relatively small, short-term loans give entrepreneurs capital to establish or expand their businesses. Because they can be more accessible than conventional financing, microloans may help people who would otherwise struggle to obtain funds. Entrepreneurs can use them to purchase equipment, employ workers, or increase production, creating benefits for the wider economy. Microfinance programs may also focus on underserved groups, including women and minorities, giving them greater access to financial resources and opportunities for economic independence. Such support can contribute to poverty reduction and social inclusion.\n\nDespite these advantages, microloan programs can also create difficulties. Critics note that limited loan amounts and short repayment schedules may put considerable financial pressure on borrowers and increase the risk of default. Their effectiveness can also depend on additional support, including financial education and business guidance, which helps borrowers manage funds responsibly and develop their enterprises. Nevertheless, microloans continue to be used to encourage entrepreneurship and economic development, and financial institutions and nonprofit organizations can improve their effectiveness by adapting these programs to the needs of different communities."],
  ["Opening Day", "Launching a new business can be both exciting and demanding because it requires careful preparation and effective planning. One important part of the launch is the grand opening, which introduces the business to the public and helps establish its brand image and customer experience. A successful opening should provide attractive activities and incentives that draw visitors and create interest in the new business.\n\nSpecial discounts and limited-time promotions can encourage guests to purchase products and recommend the business to others. Free samples or demonstrations can also allow visitors to experience the products or services directly. Entertainment such as live music, games, and interactive workshops can make the occasion more enjoyable. Giveaways and prize raffles are another way to encourage participation and keep visitors engaged.\n\nWorking with local influencers or community figures can help increase awareness and attract additional customers. Good organization and sufficient staff are also essential for providing a smooth experience. Overall, a grand opening should create a friendly and memorable atmosphere, communicate the business's unique value, and begin building lasting relationships with customers through engaging activities and appealing incentives."],
  ["Coffee Shop", "Successful coffee shops generally depend on strong customer traffic and a high number of daily sales. Many establishments serve as many as 500 customers each day and may experience several customer turnovers during the busy lunch period, even when they have limited seating and floor space. Coffee and espresso beverages can provide substantial profit margins because their primary ingredient is water. However, with an average customer purchase of roughly $3, a coffee shop needs a steady flow of customers to remain profitable. In addition to freshly roasted coffee, coffeehouses commonly sell espresso beverages such as cappuccinos and lattes, as well as tea, bottled water, fruit juices, baked items, desserts, and packaged coffee beans."],
  ["Esports", "Esports is increasingly being viewed by schools as an educational and extracurricular opportunity rather than simply a form of entertainment. Many high schools and colleges have introduced esports teams, training facilities, and organized programs, reflecting the growing role of gaming in society. These activities also give students who are not interested in conventional sports another way to participate in group activities and become more connected with their school community.\n\nEsports participation can help students develop confidence, teamwork, communication, discipline, and a stronger sense of belonging. Team members practice consistently, communicate during competitive situations, and encourage one another in ways that resemble traditional athletic teams. Such experiences may be especially useful for students who are shy or socially disconnected. Achieving success in competitions can also motivate students to attend school regularly and concentrate more on their studies.\n\nSchool reports and research have associated esports participation with positive academic engagement, including improved attendance, maintaining satisfactory grades, and higher graduation rates in some programs. Students may also think more seriously about future goals because academic progress can be required to remain eligible for their teams. These findings indicate that organized competitive gaming can serve as an additional pathway for student engagement, personal development, and preparation for future careers."]
].map(([title, passage]) => ({
  section: "writing", type: "swt", title, passage, prompt: swtPrompt, difficulty: "medium"
}));

const CLIENT_SWT_CANDIDATES = [...clientSwt];

// ---------------------------------------------------------------------------
// Client-supplied Answer Short Question batch (15) — replaces the old 20-question text-only set
// (see the SUPERSEDED comment above `answerShortQuestion`). Audio for questions 2-15 is the
// client's own TTS-generated clips, copied verbatim into client/public/audio/answer-short-question/
// (served at /audio/answer-short-question/... by Vite's default publicDir) and renamed
// answer-short-question-01..15.mp3 in place of their original random filenames.
//
// The `file` below is the VERIFIED audio for each question — confirmed by actually transcribing
// every clip (Whisper, via a throwaway @xenova/transformers + mpg123-decoder script, not by
// filename/timestamp order, which an earlier version of this batch used and which turned out to
// be wrong). Transcription found: file 04 and file 03 both contain the *same* spoken content
// ("What do you call a person who lives next to your house or in your community?" — Question
// 4/Neighbor), confirmed on two different Whisper models and by differing file checksums (so it's
// a genuine duplicate recording, not a copy/rename bug). File 04 is used for Question 4; file 03
// is an unused spare. None of the client's 15 files contained Question 1's content ("...opaque,
// vivid, brilliant, shiny?"), so its audio (answer-short-question-16.wav) was instead generated
// with Higgsfield's seed_audio text-to-speech from Question 1's own prompt text verbatim, then
// verified the same way — transcribed back and confirmed it actually says that text — before
// being wired in. `answer` is the exact short answer the client provided per question (never
// auto-graded — see STUDENT_SAFE_FIELDS in routes/questions.js for why a subjective type's
// `answer` is safe to expose as a revealable reference answer).
// ---------------------------------------------------------------------------
const clientAnswerShortQuestion = [
  ["To which of our senses do all of the following words relate, opaque, vivid, brilliant, shiny?", "Vision", "answer-short-question-16.wav"],
  ["What clothing do people wear, such as students or nurses, to show that they belong to the same organizations?", "Uniform", "answer-short-question-01.mp3"],
  ["What kind of soup utensils do you use at table?", "Spoon / Spoons", "answer-short-question-02.mp3"],
  ["What do you call a person who lives next to your house or in your community?", "Neighbor", "answer-short-question-04.mp3"],
  ["What do we call buying and transporting goods from another country?", "Import", "answer-short-question-05.mp3"],
  ["What are breakfast, lunch, and dinner examples of?", "Meal", "answer-short-question-06.mp3"],
  ["What do we call a person who writes a book?", "Author / Writer", "answer-short-question-07.mp3"],
  ["What do people usually use to cut food in the plate?", "Knife", "answer-short-question-08.mp3"],
  ["What do we call a liquid that is used for washing hair?", "Shampoo", "answer-short-question-09.mp3"],
  ["What geometric shape are circumference, diameter and radius related with?", "Circle", "answer-short-question-10.mp3"],
  ["What do you use to dry your body after a shower?", "Towel", "answer-short-question-11.mp3"],
  ["What's the grey thing in the sky when it's about to rain?", "Cloud", "answer-short-question-12.mp3"],
  ["What do we call the long, orange thing that grows underground?", "Carrot", "answer-short-question-13.mp3"],
  ["What do we call the person who plays sports to make a living?", "Athlete / Sportsman / Sportswoman", "answer-short-question-14.mp3"],
  ["What shows dishes before you order?", "Menu", "answer-short-question-15.mp3"]
].map(([prompt, answer, file], i) => ({
  section: "speaking", type: "answer-short-question", title: `Answer Short Question ${i + 1}`,
  prompt, answer, audioUrl: `/audio/answer-short-question/${file}`, difficulty: "medium"
}));

const CLIENT_ANSWER_SHORT_QUESTION_CANDIDATES = [...clientAnswerShortQuestion];

// ---------------------------------------------------------------------------
// Phase 22 — original AI-generated audio (Higgsfield seed_audio) for two of the six
// previously-audio-blocked types. Every clip was verified live before being used here: HTTP 200,
// Content-Type audio/x-wav, a genuine RIFF/WAVE file signature, and a byte size consistent with
// real spoken audio (~460-480KB) — not an HTML error page, not empty, not a placeholder.
// Budget was extremely limited (this workspace had ~1 AI-generation credit remaining), which is
// exactly why this batch is only 2 questions, covering only 2 of the 6 blocked types — see the
// Phase 22 report for the other 4, which remain genuinely blocked by the same constraint.
// ---------------------------------------------------------------------------
const selectMissingWord = [
  {
    section: "listening", type: "select-missing-word", title: "Select Missing Word 1 — Business Expansion",
    prompt: "Listen to the recording. Which word correctly completes the sentence you heard?",
    options: ["markets", "weather", "recipes", "holidays"], answer: 0,
    explanation: "The recording states that the company decided to expand its operations into new international markets.",
    audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260904_112941_1394221f-dcad-4c5a-898a-3c50f53464c7.wav",
    difficulty: "medium"
  }
];

const listeningFillBlanks = [
  {
    section: "listening", type: "fill-blanks", title: "Listening Fill in the Blanks 1 — Library Hours",
    prompt: "Listen to the recording, then choose the word that correctly completes the sentence.",
    passage: "The library closes early on ____.",
    options: ["Sundays", "Mondays", "Wednesdays", "Fridays"], answer: 0,
    explanation: "The recording states that the library closes early on Sundays.",
    audioUrl: "https://d8j0ntlcm91z4.cloudfront.net/user_3HdRF1J7vWgr99MGyL631BlHLcd/hf_20260904_113050_6bdcccc8-d4e8-4f72-a0dc-2c23f8a7e907.wav",
    difficulty: "easy"
  }
];

const PHASE22_MEDIA_CANDIDATES = [...selectMissingWord, ...listeningFillBlanks];

const PHASE18_ALL_CANDIDATES = [
  ...PHASE18_TEXT_ONLY_CANDIDATES, ...PHASE18_MEDIA_CANDIDATES,
  ...PHASE20_TEXT_CANDIDATES, ...PHASE22_MEDIA_CANDIDATES, ...PHASE23_TEXT_CANDIDATES,
  ...CLIENT_ANSWER_SHORT_QUESTION_CANDIDATES, ...CLIENT_CORE_P_CANDIDATES, ...CLIENT_SWT_CANDIDATES
];

// Guards against two overlapping calls *within this same process* racing each other's
// read-then-insert (both would see the same "existing" snapshot and both insert everything).
// This does NOT protect against two separate server processes hitting the same database at
// once — that happened for real during this feature's development, when two independent
// `node --watch` instances were both running and both restarted (and both re-seeded) on every
// file save, producing genuine duplicate documents that had to be cleaned up by hand. Never run
// more than one server process against the same MONGODB_URI at a time.
let inFlight = null;

export async function seedPhase18Content(candidates = PHASE18_ALL_CANDIDATES) {
  if (inFlight) return inFlight;
  inFlight = runSeed(candidates);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function runSeed(candidates) {
  const existing = await Question.find({}).select("type prompt passage options answer imageUrl audioUrl");
  const seen = new Set(existing.map(signature));
  let inserted = 0, skippedDuplicate = 0, skippedInvalid = 0;
  const invalidReport = [];

  for (const q of candidates) {
    const sig = signature(q);
    if (seen.has(sig)) { skippedDuplicate++; continue; }

    const { errors, normalized } = validateAndNormalizeQuestion(q);
    if (errors.length) { skippedInvalid++; invalidReport.push({ title: q.title, errors }); continue; }

    seen.add(sig);
    await Question.create({ ...q, ...normalized, active: q.active !== false });
    inserted++;
  }

  if (inserted) console.log(`Phase 18 content: inserted ${inserted} new question(s).`);
  if (skippedDuplicate) console.log(`Phase 18 content: skipped ${skippedDuplicate} duplicate candidate(s).`);
  if (skippedInvalid) console.warn(`Phase 18 content: skipped ${skippedInvalid} invalid candidate(s):`, invalidReport);

  return { inserted, skippedDuplicate, skippedInvalid, invalidReport };
}

export {
  PHASE18_TEXT_ONLY_CANDIDATES, PHASE18_MEDIA_CANDIDATES, PHASE20_TEXT_CANDIDATES,
  PHASE22_MEDIA_CANDIDATES, PHASE23_TEXT_CANDIDATES, CLIENT_DESCRIBE_IMAGE_CANDIDATES,
  CLIENT_ANSWER_SHORT_QUESTION_CANDIDATES, CLIENT_CORE_P_CANDIDATES, CLIENT_SWT_CANDIDATES,
  PHASE18_ALL_CANDIDATES, signature
};
