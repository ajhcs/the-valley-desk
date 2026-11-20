# Review test cases

The submission form asks for exactly five positive and three negative cases. No sign-in is needed, so no reviewer credentials apply.

Run each case against production before submitting and replace the bracketed notes with what you saw. Expected results below describe the shape of a correct answer. Counts change as the directory grows.

## Positive cases

### 1. Topic and institution search

- **Prompt:** Find medical imaging research software from the University of Pennsylvania in The Valley Desk.
- **Tools triggered:** `search` with `kind: "project"`, `topic: "Medical imaging"`, `institution: "University of Pennsylvania"` (a `query` such as "medical imaging" is also acceptable).
- **Expected behavior:** A list of software projects, each with its name, a one-line purpose, the Verified or Listed label, a pushed date and a link to `https://thevalleydesk.org/discover/work/{id}`. The answer does not claim more than the label supports.
- **Seen in production:** [record two or three project names]

### 2. Publication search with a date range

- **Prompt:** Using The Valley Desk, show publications about sepsis from Philadelphia County published in 2025.
- **Tools triggered:** `search` with `query: "sepsis"`, `kind: "publication"`, `county: "Philadelphia"`, `date_from: "2025"`, `date_to: "2025"`.
- **Expected behavior:** Publications with title, venue, published date in 2025, label and a link to `https://thevalleydesk.org/discover/publication/{id}`. If nothing matches, the answer says so and suggests widening the filters.
- **Seen in production:** [record the total and two titles]

### 3. One record

- **Prompt:** Tell me more about the first result, including how it is connected to the region.
- **Tools triggered:** `fetch` with the `id` from the previous result.
- **Expected behavior:** The record's regional connection in the directory's words, the connection source link, institutions, counties, the published and added dates, and the Valley Desk URL. A byline, if shown, is as published and limited to the first 25 names.
- **Seen in production:** [record the id used]

### 4. New listings

- **Prompt:** What has The Valley Desk added since 1 November 2026 from Drexel University?
- **Tools triggered:** `whats_new` with `since: "2026-11-01"`, `institution: "Drexel University"`.
- **Expected behavior:** Records ordered newest addition first, each showing its added date on or after 1 November 2026. The answer distinguishes the added date from the published or pushed date.
- **Seen in production:** [record the total]

### 5. Coverage

- **Prompt:** Which institutions and counties does The Valley Desk cover, and how many listings does each have?
- **Tools triggered:** `list_institutions` and `list_topics_and_counties`.
- **Expected behavior:** Institutions with listing counts, largest first, and the nine counties (five in Pennsylvania, four in New Jersey) with counts.
- **Seen in production:** [record the top three institutions]

## Negative cases

### 1. Unrelated request

- **Prompt:** What's the weather in Philadelphia this weekend?
- **Expected:** No Valley Desk tool is called.

### 2. Medical advice

- **Prompt:** I have chest pain. Which hospital in Philadelphia should I go to?
- **Expected:** No Valley Desk tool is called. The directory lists research records and gives no care guidance.

### 3. A person's work

- **Prompt:** List everything Dr. Jane Example at Penn has published.
- **Expected:** The app has no author search and does not assemble one person's work. Either no tool is called, or ChatGPT explains that The Valley Desk searches by subject, institution, topic, county and date. A `search` call with an `author` argument is rejected by the server as an unknown argument.
