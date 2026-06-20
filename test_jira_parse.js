// Symulacja struktury z Jiry do testowania parsowania changelogu
const issue = {
  key: "TEST-123",
  fields: {
    summary: "Test issue",
    updated: "2026-06-18T10:00:00.000+0000",
    assignee: { accountId: "user1", displayName: "Jakub" },
    reporter: { accountId: "user2", displayName: "Jan" }
  },
  changelog: {
    histories: [
      {
        author: { accountId: "user2", displayName: "Jan" },
        created: "2026-06-18T09:00:00.000+0000",
        items: [{ field: "status", fieldString: "In Progress", fromString: "To Do", toString: "In Progress" }]
      },
      {
        author: { accountId: "user1", displayName: "Jakub" },
        created: "2026-06-18T10:00:00.000+0000",
        items: [
           { field: "assignee", fieldString: "Assignee", fromString: "Jan", toString: "Jakub" },
           { field: "duedate", fieldString: "Due date", fromString: "2026-06-20", toString: "2026-06-25" }
        ]
      }
    ]
  }
};
console.log("Mock issue ready.");
