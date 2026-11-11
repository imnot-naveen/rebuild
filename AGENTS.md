# Rebuild project instructions

## Working plan

Read `docs/STATUS.md` and the relevant product or engineering notes before starting work. Consult the local delivery plan under `init docs (don't commit)` when available. Keep the original planning documents out of Git.

Work on the next eligible task. Coach and review central domain rules, transaction code, matching, and selected frontend work so Naveen can attempt the core decisions and implementation. Handle routine scaffolding and checks directly.

Update `docs/STATUS.md` with evidence, open decisions, assistance, and the next action after each meaningful session. Mark a task done once its acceptance criteria are demonstrated.

## Daily closeout

Do project work on a branch off `main`. At the end of each workday, push the branch, open a pull request targeting `main`, and send Naveen the PR link so he can review and merge it. Leave the merge to Naveen.

## Commit messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for every commit you create in Rebuild. Write the subject as `<type>(<scope>): <description>` and omit `(<scope>)` when a scope adds no useful context. Use a short, imperative description. For example, `docs: define the data and API contract`.
