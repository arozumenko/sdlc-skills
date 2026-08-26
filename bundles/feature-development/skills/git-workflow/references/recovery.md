# Git Recovery Scenarios

## Undo last commit (keep changes)
```bash
git reset --soft HEAD~1
```

## Recover deleted branch
```bash
git reflog | grep "branch-name"
git checkout -b branch-name <sha>
```

## Unstage files
```bash
git restore --staged file.py
```

## Discard changes to one file
```bash
git checkout -- file.py     # confirm with user first
```

## Fix wrong commit message (unpublished only)
```bash
git commit --amend -m "corrected message"
```

## Resolve merge conflict
1. `git --no-pager diff --name-only --diff-filter=U` — list conflicted files
2. Read each file, find `<<<<<<<` markers
3. Edit to resolve (keep correct version)
4. `git add <resolved-files>`
5. `git commit` (no -m, uses merge message)

## Abort in-progress operations
```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```
