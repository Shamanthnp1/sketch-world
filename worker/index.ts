// Placeholder so the Worker builds and tests boot; task 1.2 replaces it with the router.
export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
