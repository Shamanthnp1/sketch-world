import { jsonError } from "../http";

// Stubs until tasks 9.1 (save) and 9.2 (read, delete).
export const saveWorld = async (): Promise<Response> => jsonError(501, "Not implemented");
export const getWorld = async (): Promise<Response> => jsonError(501, "Not implemented");
export const deleteWorld = async (): Promise<Response> => jsonError(501, "Not implemented");
