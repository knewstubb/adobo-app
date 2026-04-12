# Ticket Manager

A Gantt-style timeline view for Azure DevOps work items, built with Next.js and Supabase.

## Gantt Visibility Logic

Work items go through a multi-stage filtering pipeline before appearing on the Gantt chart. The pipeline runs in order — each stage operates on the output of the previous one.

### 1. Data Fetch (Supabase Cache)

All work items are loaded from the local Supabase cache. The cache is populated by a background sync engine that fetches from Azure DevOps via WIQL queries scoped to configured area paths. Items in `Removed` state are excluded during sync.

### 2. Done Filter

If the "Done hidden" toggle is active (default), all items with `state === "Done"` are removed. Toggle "Done hidden" in the toolbar to show them.

### 3. Iteration View Filter

If the "Sprint View" toggle is active and a specific sprint is selected, only items whose `iterationPath` exactly matches the selected sprint are kept. Parent items (Initiatives, Epics, Features) that don't have a sprint assigned will be filtered out at this stage.

### 4. General Filters

The toolbar filter buttons (Status, Iteration, Person) apply conjunctive (AND) filters:
- **Status**: only items matching selected states
- **Iteration**: only items matching selected iteration paths
- **Person**: only items matching selected assignees
- **Epic/Feature/Initiative**: only items matching selected parent IDs

### 5. Visibility Filter

Items explicitly hidden via the Visibility modal are removed, along with all their descendants.

### 6. Removed Ancestor Filter

Any item that has an ancestor in `Removed` state is excluded. This cascades — if a grandparent is Removed, all descendants are hidden regardless of their own state.

### 7. Ancestor Preservation

After all filters, the pipeline walks up the parent chain of every remaining visible item. If a parent is missing from the visible set (because it was filtered out in steps 2-5), it is re-added — provided it is not in `Removed` state. This prevents orphaned items from appearing at root level in the tree.

### 8. Task Exclusion

`Task` work item types are excluded from the Gantt tree entirely. They are sub-work items tracked elsewhere and don't appear as rows.

### 9. Tree Construction

The remaining items are assembled into a hierarchy based on `parentId` relationships. Items whose parent is not in the visible set become root-level nodes.

### Summary Bar Logic

- **Leaf items** (PBI, Bug, User Story): bars are positioned using `localStartDate`/`localEndDate` if set, otherwise by matching `iterationPath` to a known iteration's date range.
- **Summary items** (Initiative, Epic, Feature): bars span the full date range of their visible children. If no children have dates, the summary has no bar.

### Timeline Scope

The timeline only shows FY26 iterations under `Spark\Sprints\FY26\`. Iterations from other fiscal years are excluded from the timeline range and markers.

## Getting Started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

See `.env.local` for required configuration:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — local Supabase connection
- `ADO_ORG` / `ADO_PROJECT` / `ADO_TEAM` / `ADO_PAT` — Azure DevOps sync credentials
- `ADO_TRACKED_PARENT_IDS` — comma-separated parent IDs to scope the sync
- `SYNC_INTERVAL_MS` — background sync interval (default 5 minutes)
