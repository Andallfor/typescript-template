export const HOME_RESERVED = 64;
export const BATCH_STEP = 50; // time between h/g/w

export interface distributeResults {
    hack: [string, number][], // where number is number of threads
    grow: [string, number],
    weakOne: [string, number][],
    weakTwo: [string, number][],
    // tracks what servers have been affected by hack/grow and their remaining ram
    // TODO: this allows chaining distributes together
    modifiedServers: Record<string, number>,
}