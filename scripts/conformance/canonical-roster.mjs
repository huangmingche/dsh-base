/** Pack-independent production rosters used as the grouping audit's oracle. */
export {
  readClientMetadataRows as canonicalClientRows,
  readWorkerMetadataRows as canonicalWorkerRows,
  readAgentMetadataRows as canonicalAgentRows,
} from "../composition/metadata-roster.mjs";
