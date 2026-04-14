/**
 * ADO Connector
 *
 * Wraps Azure DevOps API calls for the ticket-manager app.
 * This module provides the data fetching and write-back layer.
 *
 * All functions accept an AdoCredentials object as the first parameter
 * instead of reading from process.env. Authentication uses btoa()
 * (browser-native base64) instead of Node.js Buffer.
 */

import type { WorkItem, Iteration, TeamMember } from "./types";
import type { AdoCredentials } from "./credential-store";

export function getHeaders(creds: AdoCredentials): HeadersInit {
  const token = btoa(":" + creds.pat);
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
  };
}

function adoUrl(creds: AdoCredentials, path: string): string {
  return `https://dev.azure.com/${creds.org}/${creds.project}/_apis/${path}`;
}

// --- Fetch Work Items ---

interface AdoWorkItemFields {
  "System.Title": string;
  "System.State": string;
  "System.AssignedTo"?: { displayName: string; uniqueName: string };
  "System.IterationPath"?: string;
  "System.AreaPath"?: string;
  "System.WorkItemType": string;
  "System.Description"?: string;
  "System.Parent"?: number;
  "System.Tags"?: string;
  "Microsoft.VSTS.Common.StackRank"?: number;
  "Microsoft.VSTS.Common.BacklogPriority"?: number;
  "System.ChangedDate"?: string;
  "Microsoft.VSTS.Common.AcceptanceCriteria"?: string;
  "Microsoft.VSTS.Scheduling.Effort"?: number;
  "Microsoft.VSTS.Common.Priority"?: number;
}

export async function fetchWorkItems(creds: AdoCredentials, areaPaths?: string[]): Promise<WorkItem[]> {
  // If area paths provided, fetch by area path
  if (areaPaths && areaPaths.length > 0) {
    return fetchWorkItemsByAreaPaths(creds, areaPaths);
  }

  // No area paths: fetch everything
  const wiqlBody = {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${creds.project}' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC`,
  };

  const wiqlRes = await fetch(adoUrl(creds, "wit/wiql?api-version=7.1"), {
    method: "POST",
    headers: getHeaders(creds),
    body: JSON.stringify(wiqlBody),
  });

  if (!wiqlRes.ok) {
    const errorBody = await wiqlRes.text();
    throw new Error(`ADO WIQL query failed: ${wiqlRes.status} ${wiqlRes.statusText} - ${errorBody}`);
  }

  const wiqlData = await wiqlRes.json();
  const ids: number[] = (wiqlData.workItems ?? []).map(
    (wi: { id: number }) => wi.id
  );

  if (ids.length === 0) return [];
  return fetchWorkItemsByIds(creds, ids);
}

async function fetchWorkItemsByAreaPaths(creds: AdoCredentials, areaPaths: string[]): Promise<WorkItem[]> {
  // Build WIQL with UNDER clause for each area path
  const areaConditions = areaPaths
    .map(p => `[System.AreaPath] UNDER '${p.replace(/'/g, "''")}'`)
    .join(" OR ");

  const wiqlBody = {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${creds.project}' AND [System.State] <> 'Removed' AND (${areaConditions}) ORDER BY [System.ChangedDate] DESC`,
  };

  const wiqlRes = await fetch(adoUrl(creds, "wit/wiql?api-version=7.1"), {
    method: "POST",
    headers: getHeaders(creds),
    body: JSON.stringify(wiqlBody),
  });

  if (!wiqlRes.ok) {
    const errorBody = await wiqlRes.text();
    throw new Error(`ADO area path query failed: ${wiqlRes.status} - ${errorBody}`);
  }

  const wiqlData = await wiqlRes.json();
  const ids: number[] = (wiqlData.workItems ?? []).map(
    (wi: { id: number }) => wi.id
  );

  if (ids.length === 0) return [];
  return fetchWorkItemsByIds(creds, ids);
}

async function fetchTreeIds(creds: AdoCredentials, parentIds: string[]): Promise<number[]> {
  // Use a Tree query to get all descendants of the tracked parents
  const idList = parentIds.join(",");
  const wiqlBody = {
    query: `SELECT [System.Id] FROM WorkItemLinks WHERE ([Source].[System.Id] IN (${idList}) OR [Source].[System.Parent] IN (${idList})) AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.State] <> 'Removed' MODE (Recursive)`,
  };

  const wiqlRes = await fetch(adoUrl(creds, "wit/wiql?api-version=7.1"), {
    method: "POST",
    headers: getHeaders(creds),
    body: JSON.stringify(wiqlBody),
  });

  if (!wiqlRes.ok) {
    // Fallback: use flat query with parent filter
    console.warn("Tree query failed, falling back to flat query with parent IDs");
    return fetchFlatChildIds(creds, parentIds);
  }

  const wiqlData = await wiqlRes.json();
  const relations = wiqlData.workItemRelations ?? [];
  const ids = new Set<number>();

  // Add the parent IDs themselves
  for (const id of parentIds) {
    ids.add(Number(id));
  }

  // Add all targets from the tree
  for (const rel of relations) {
    if (rel.target?.id) ids.add(rel.target.id);
    if (rel.source?.id) ids.add(rel.source.id);
  }

  return [...ids];
}

async function fetchFlatChildIds(creds: AdoCredentials, parentIds: string[]): Promise<number[]> {
  // Simple fallback: fetch items where parent is one of the tracked IDs
  // This only gets direct children, not deep descendants
  const idList = parentIds.join(",");
  const wiqlBody = {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${creds.project}' AND [System.State] <> 'Removed' AND ([System.Id] IN (${idList}) OR [System.Parent] IN (${idList})) ORDER BY [System.ChangedDate] DESC`,
  };

  const wiqlRes = await fetch(adoUrl(creds, "wit/wiql?api-version=7.1"), {
    method: "POST",
    headers: getHeaders(creds),
    body: JSON.stringify(wiqlBody),
  });

  if (!wiqlRes.ok) {
    const errorBody = await wiqlRes.text();
    throw new Error(`ADO flat query failed: ${wiqlRes.status} - ${errorBody}`);
  }

  const wiqlData = await wiqlRes.json();
  return (wiqlData.workItems ?? []).map((wi: { id: number }) => wi.id);
}

async function fetchWorkItemsByIds(creds: AdoCredentials, ids: number[]): Promise<WorkItem[]> {
  if (ids.length === 0) return [];

  const allItems: WorkItem[] = [];
  const batchSize = 200;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const fields = [
      "System.Title",
      "System.State",
      "System.AssignedTo",
      "System.IterationPath",
      "System.AreaPath",
      "System.WorkItemType",
      "System.Description",
      "System.Parent",
      "System.Tags",
      "Microsoft.VSTS.Common.StackRank",
      "Microsoft.VSTS.Common.BacklogPriority",
      "System.ChangedDate",
      "Microsoft.VSTS.Common.AcceptanceCriteria",
      "Microsoft.VSTS.Scheduling.Effort",
      "Microsoft.VSTS.Common.Priority",
    ];

    const batchRes = await fetch(
      adoUrl(creds, `wit/workitems?ids=${batchIds.join(",")}&fields=${fields.join(",")}&api-version=7.1`),
      { headers: getHeaders(creds) }
    );

    if (!batchRes.ok) {
      throw new Error(`ADO batch fetch failed: ${batchRes.status} ${batchRes.statusText}`);
    }

    const batchData = await batchRes.json();

    for (const wi of batchData.value ?? []) {
      const f: AdoWorkItemFields = wi.fields;

      // Defensive: skip Removed items even if WIQL missed them
      if (f["System.State"] === "Removed") continue;

      allItems.push({
        id: wi.id,
        title: f["System.Title"],
        state: f["System.State"],
        assignedTo: f["System.AssignedTo"]?.displayName ?? null,
        iterationPath: f["System.IterationPath"] ?? null,
        areaPath: f["System.AreaPath"] ?? null,
        workItemType: f["System.WorkItemType"],
        description: f["System.Description"] ?? null,
        acceptanceCriteria: f["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? null,
        parentId: f["System.Parent"] ?? null,
        initiativeId: null, // resolved during hierarchy build
        epicId: null,
        featureId: null,
        tags: f["System.Tags"]
          ? f["System.Tags"].split(";").map((t) => t.trim()).filter(Boolean)
          : [],
        stackRank: f["Microsoft.VSTS.Common.StackRank"] ?? null,
        adoChangedDate: f["System.ChangedDate"]
          ? new Date(f["System.ChangedDate"])
          : null,
        cachedAt: new Date(),
        localSortOrder: f["Microsoft.VSTS.Common.BacklogPriority"] ?? f["Microsoft.VSTS.Common.StackRank"] ?? 0,
        localStartDate: null,
        localEndDate: null,
        effort: f["Microsoft.VSTS.Scheduling.Effort"] ?? null,
        priority: f["Microsoft.VSTS.Common.Priority"] ?? null,
      });
    }
  }

  // Step 3: Resolve hierarchy (initiative, epic, feature IDs)
  return resolveHierarchy(allItems);
}

function resolveHierarchy(items: WorkItem[]): WorkItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const item of items) {
    let current = item;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;

      if (parent.workItemType === "Feature") {
        item.featureId = parent.id;
      } else if (parent.workItemType === "Epic") {
        item.epicId = parent.id;
      } else if (parent.workItemType === "Initiative") {
        item.initiativeId = parent.id;
      }
      current = parent;
    }
  }

  return items;
}

// --- Fetch Iterations ---

export async function fetchIterations(creds: AdoCredentials): Promise<Iteration[]> {
  // Use the team iterations API to get only the team's assigned sprints
  const teamEncoded = encodeURIComponent(creds.team);
  const res = await fetch(
    `https://dev.azure.com/${creds.org}/${creds.project}/${teamEncoded}/_apis/work/teamsettings/iterations?api-version=7.1`,
    { headers: getHeaders(creds) }
  );

  if (!res.ok) {
    throw new Error(`ADO iterations fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.value ?? [])
    .filter((iter: { attributes?: { startDate?: string; finishDate?: string } }) =>
      iter.attributes?.startDate && iter.attributes?.finishDate
    )
    .map((iter: { path: string; name: string; attributes: { startDate: string; finishDate: string } }) => ({
      path: iter.path,
      name: iter.name,
      startDate: new Date(iter.attributes.startDate),
      endDate: new Date(iter.attributes.finishDate),
    }));
}

// --- Fetch Team Members ---

export async function fetchTeamMembers(creds: AdoCredentials): Promise<TeamMember[]> {
  const res = await fetch(
    `https://dev.azure.com/${creds.org}/_apis/projects/${creds.project}/teams?api-version=7.1`,
    { headers: getHeaders(creds) }
  );

  if (!res.ok) {
    throw new Error(`ADO teams fetch failed: ${res.status} ${res.statusText}`);
  }

  const teamsData = await res.json();
  const members: TeamMember[] = [];
  const seen = new Set<string>();

  for (const team of teamsData.value ?? []) {
    const membersRes = await fetch(
      `https://dev.azure.com/${creds.org}/_apis/projects/${creds.project}/teams/${team.id}/members?api-version=7.1`,
      { headers: getHeaders(creds) }
    );
    if (!membersRes.ok) continue;

    const membersData = await membersRes.json();
    for (const m of membersData.value ?? []) {
      const identity = m.identity;
      if (!identity || seen.has(identity.uniqueName)) continue;
      seen.add(identity.uniqueName);
      members.push({
        uniqueName: identity.uniqueName,
        displayName: identity.displayName,
        imageUrl: identity.imageUrl ?? null,
      });
    }
  }

  return members;
}

// --- Write Operations ---

export async function updateWorkItemField(
  creds: AdoCredentials,
  workItemId: number,
  field: string,
  value: string | number
): Promise<void> {
  const body: Array<{ op: string; path: string; value: string | number }> = [
    {
      op: "replace",
      path: `/fields/${field}`,
      value,
    },
  ];

  // For large text fields, force Markdown mode so ADO doesn't flip to HTML
  const MARKDOWN_FIELDS = ["System.Description", "Microsoft.VSTS.Common.AcceptanceCriteria", "Microsoft.VSTS.TCM.ReproSteps"];
  if (MARKDOWN_FIELDS.includes(field)) {
    body.push({
      op: "add",
      path: `/multilineFieldsFormat/${field}`,
      value: "Markdown",
    });
  }

  const res = await fetch(
    adoUrl(creds, `wit/workitems/${workItemId}?api-version=7.1`),
    {
      method: "PATCH",
      headers: {
        ...getHeaders(creds),
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `ADO update failed for item ${workItemId}: ${res.status} ${errorText}`
    );
  }
}

export async function updateWorkItemTags(
  creds: AdoCredentials,
  workItemId: number,
  tags: string[]
): Promise<void> {
  await updateWorkItemField(creds, workItemId, "System.Tags", tags.join("; "));
}

export async function updateWorkItemParent(
  creds: AdoCredentials,
  workItemId: number,
  newParentId: number
): Promise<void> {
  // First try to remove existing parent
  const getRes = await fetch(
    adoUrl(creds, `wit/workitems/${workItemId}?$expand=relations&api-version=7.1`),
    { headers: getHeaders(creds) }
  );

  if (getRes.ok) {
    const itemData = await getRes.json();
    const relations = itemData.relations ?? [];
    const parentRelIdx = relations.findIndex(
      (r: { rel: string }) => r.rel === "System.LinkTypes.Hierarchy-Reverse"
    );

    const ops: unknown[] = [];

    // Remove existing parent if present
    if (parentRelIdx >= 0) {
      ops.push({
        op: "remove",
        path: `/relations/${parentRelIdx}`,
      });
    }

    // Add new parent
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${creds.org}/${creds.project}/_apis/wit/workitems/${newParentId}`,
      },
    });

    const patchRes = await fetch(
      adoUrl(creds, `wit/workitems/${workItemId}?api-version=7.1`),
      {
        method: "PATCH",
        headers: {
          ...getHeaders(creds),
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify(ops),
      }
    );

    if (!patchRes.ok) {
      const errorText = await patchRes.text();
      throw new Error(`ADO parent update failed: ${patchRes.status} ${errorText}`);
    }
  }
}

export async function reorderWorkItems(
  creds: AdoCredentials,
  ids: number[],
  previousId: number,
  nextId: number,
  parentId?: number
): Promise<boolean> {
  const teamEncoded = encodeURIComponent(creds.team);
  const body: Record<string, unknown> = { ids, previousId, nextId };
  if (parentId !== undefined) body.parentId = parentId;

  const res = await fetch(
    `https://dev.azure.com/${creds.org}/${creds.project}/${teamEncoded}/_apis/work/workitemsorder?api-version=7.1`,
    {
      method: "PATCH",
      headers: getHeaders(creds),
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("ADO reorder failed:", res.status, text.substring(0, 200));
    return false;
  }
  return true;
}

export async function createWorkItem(
  creds: AdoCredentials,
  parentId: number,
  workItemType: string,
  title: string,
  iterationPath?: string
): Promise<{ id: number }> {
  const body: { op: string; path: string; value: unknown }[] = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.AreaPath", value: `${creds.project}\\Tribes\\No Tribe\\UbiQuity Teams\\CX-AI Team` },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${creds.org}/${creds.project}/_apis/wit/workitems/${parentId}`,
      },
    },
  ];
  if (iterationPath) {
    body.push({ op: "add", path: "/fields/System.IterationPath", value: iterationPath });
  }

  const typeEncoded = encodeURIComponent(workItemType);
  const res = await fetch(
    adoUrl(creds, `wit/workitems/$${typeEncoded}?api-version=7.1`),
    {
      method: "POST",
      headers: {
        ...getHeaders(creds),
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`ADO create failed: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  return { id: data.id };
}

/** Fetch the backlog order for PBIs from ADO. Returns item IDs in backlog order. */
export async function fetchBacklogOrderForCategory(creds: AdoCredentials, category: string): Promise<number[]> {
  const teamEncoded = encodeURIComponent(creds.team);
  const res = await fetch(
    `https://dev.azure.com/${creds.org}/${creds.project}/${teamEncoded}/_apis/work/backlogs/${category}/workItems?api-version=7.1`,
    { headers: getHeaders(creds) }
  );
  if (!res.ok) {
    console.error(`Failed to fetch backlog order for ${category}:`, res.status);
    return [];
  }
  const data = await res.json();
  return (data.workItems ?? []).map((wi: { target: { id: number } }) => wi.target.id);
}

/** Fetch backlog order for PBIs only (legacy — use fetchAllBacklogOrders instead) */
export async function fetchBacklogOrder(creds: AdoCredentials): Promise<number[]> {
  return fetchBacklogOrderForCategory(creds, "Microsoft.RequirementCategory");
}

/** Fetch backlog order for all work item categories: Epics, Features, and PBIs */
export async function fetchAllBacklogOrders(creds: AdoCredentials): Promise<Map<number, number>> {
  const [epics, features, requirements] = await Promise.all([
    fetchBacklogOrderForCategory(creds, "Microsoft.EpicCategory"),
    fetchBacklogOrderForCategory(creds, "Microsoft.FeatureCategory"),
    fetchBacklogOrderForCategory(creds, "Microsoft.RequirementCategory"),
  ]);

  const orderMap = new Map<number, number>();
  // Each category gets its own sequential ordering
  for (const list of [epics, features, requirements]) {
    for (let i = 0; i < list.length; i++) {
      orderMap.set(list[i], (i + 1) * 100);
    }
  }
  return orderMap;
}
