import { Event } from "@project-serum/anchor";
import { BorshEventCoder } from "@project-serum/anchor/dist/cjs/coder/borsh/event";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import { PublicKey, VersionedTransactionResponse } from "@solana/web3.js";

export interface ParsedSolEvents {
  chainPoolEvents: ParsedSolEvent[];
  receiverEvents: ParsedSolEvent[];
}

export interface ParsedSolEvent {
  event: Event;
  programId: string;
}

export interface SolEventParserOptions {
  eventProgramIds?: string[];
  chainPoolProgramId?: string;
  receiverProgramId?: string;
}

const ANCHOR_EVENT_CPI_PREFIX = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
const CHAIN_POOL_EVENT_NAMES = new Set(["CrossOutEvent"]);
const RECEIVER_CROSS_IN_EVENT_NAMES = new Set(["CrossInEvent", "RefundEvent"]);
const DEFAULT_CHAIN_POOL_PROGRAM_ID = "mosv35NjuYkM8iMdihM96cG2ZziU2RJYZfSaGuV8uF6";
const DEFAULT_RECEIVER_PROGRAM_ID = "rcvr2wL88Bg3eBGH4Hr7VjugbDLm5YafBraggmmuRGJ";

export class SolEventParser {
  readonly chainPoolProgramId: PublicKey;
  readonly receiverProgramId: PublicKey;

  private readonly chainPoolCoder: BorshEventCoder;
  private readonly receiverCoder: BorshEventCoder;
  private readonly eventProgramIds: PublicKey[];

  constructor(options: SolEventParserOptions = {}) {
    const chainPoolIdl = require("../../../src/chain/sol/chainpool.json");
    const receiverIdl = require("../../../src/chain/sol/receiver.json");

    this.chainPoolProgramId = new PublicKey(options.chainPoolProgramId || DEFAULT_CHAIN_POOL_PROGRAM_ID);
    this.receiverProgramId = new PublicKey(options.receiverProgramId || DEFAULT_RECEIVER_PROGRAM_ID);
    this.chainPoolCoder = new BorshEventCoder(toEventOnlyIdl(chainPoolIdl));
    this.receiverCoder = new BorshEventCoder(toEventOnlyIdl(receiverIdl));
    this.eventProgramIds = Array.from(new Set(options.eventProgramIds || []))
      .filter((programId) => !!programId)
      .map((programId) => new PublicKey(programId));
  }

  parseTransaction(trx: VersionedTransactionResponse | null): ParsedSolEvents {
    return this.parseInnerInstructionEvents(trx);
  }

  private parseInnerInstructionEvents(trx: VersionedTransactionResponse | null): ParsedSolEvents {
    const ret: ParsedSolEvents = {
      chainPoolEvents: [],
      receiverEvents: [],
    };
    const innerInstructions = trx?.meta?.innerInstructions ?? [];
    const accountKeys = trx?.transaction.message.getAccountKeys({
      accountKeysFromLookups: trx.meta?.loadedAddresses,
    });

    if (!accountKeys) {
      return ret;
    }

    for (const group of innerInstructions) {
      for (const instruction of group.instructions) {
        const programId = accountKeys.get(instruction.programIdIndex);
        if (!programId) {
          continue;
        }

        if (programId.equals(this.chainPoolProgramId)) {
          const event = this.decodeEventCpi(instruction.data, this.chainPoolCoder);
          if (event && CHAIN_POOL_EVENT_NAMES.has(event.name)) {
            ret.chainPoolEvents.push(toParsedEvent(event, programId));
          }
          continue;
        }

        if (programId.equals(this.receiverProgramId)) {
          const event = this.decodeEventCpi(instruction.data, this.receiverCoder);
          if (event && RECEIVER_CROSS_IN_EVENT_NAMES.has(event.name)) {
            ret.receiverEvents.push(toParsedEvent(event, programId));
          }
          continue;
        }

        if (this.isEventProgramAlias(programId)) {
          const chainPoolEvent = this.decodeEventCpi(instruction.data, this.chainPoolCoder);
          if (chainPoolEvent && CHAIN_POOL_EVENT_NAMES.has(chainPoolEvent.name)) {
            ret.chainPoolEvents.push(toParsedEvent(chainPoolEvent, programId));
            continue;
          }

          const receiverEvent = this.decodeEventCpi(instruction.data, this.receiverCoder);
          if (receiverEvent && RECEIVER_CROSS_IN_EVENT_NAMES.has(receiverEvent.name)) {
            ret.receiverEvents.push(toParsedEvent(receiverEvent, programId));
          }
        }
      }
    }

    return ret;
  }

  private isEventProgramAlias(programId: PublicKey): boolean {
    return this.eventProgramIds.some((eventProgramId) => eventProgramId.equals(programId));
  }

  private decodeEventCpi(data: string, coder: BorshEventCoder): Event | null {
    let raw: Buffer;
    try {
      raw = Buffer.from(bs58.decode(data));
    } catch (_) {
      return null;
    }

    if (raw.length <= ANCHOR_EVENT_CPI_PREFIX.length) {
      return null;
    }
    if (!raw.subarray(0, ANCHOR_EVENT_CPI_PREFIX.length).equals(ANCHOR_EVENT_CPI_PREFIX)) {
      return null;
    }

    try {
      const event = coder.decode(raw.subarray(ANCHOR_EVENT_CPI_PREFIX.length).toString("base64"));
      return event ? normalizeEventDataAliases(event) : null;
    } catch (_) {
      return null;
    }
  }
}

function toParsedEvent(event: Event, programId: PublicKey): ParsedSolEvent {
  return {
    event,
    programId: programId.toBase58(),
  };
}

function normalizeEventDataAliases(event: Event): Event {
  for (const key of Object.keys(event.data)) {
    event.data[camelToSnakeCase(key)] = event.data[key];
  }

  return event;
}

function camelToSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toEventOnlyIdl(idl: any): any {
  const typesByName = new Map((idl.types || []).map((typeDef: any) => [typeDef.name, typeDef]));
  const events = (idl.events || []).map((event: any) => {
    if (event.fields) {
      return {
        ...event,
        fields: normalizeFields(event.fields),
      };
    }

    const eventType = typesByName.get(event.name) as any;
    if (!eventType?.type?.fields) {
      throw new Error(`Event type not found in IDL types: ${event.name}`);
    }

    return {
      name: event.name,
      fields: normalizeFields(eventType.type.fields).map((field: any) => ({
        ...field,
        index: false,
      })),
    };
  });

  return {
    version: idl.version || idl.metadata?.version || "0.1.0",
    name: idl.name || idl.metadata?.name || "program",
    instructions: [],
    types: normalizeTypes(idl.types || []),
    events,
  };
}

function normalizeTypes(types: any[]): any[] {
  return types.map((typeDef) => ({
    ...typeDef,
    type: normalizeIdlType(typeDef.type),
  }));
}

function normalizeFields(fields: any[]): any[] {
  return fields.map((field) => ({
    ...field,
    type: normalizeIdlType(field.type),
  }));
}

function normalizeIdlType(type: any): any {
  if (type === "pubkey") {
    return "publicKey";
  }
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    return type.map(normalizeIdlType);
  }
  if (type?.defined?.name) {
    return {
      defined: type.defined.name,
    };
  }
  if (type?.vec !== undefined) {
    return {
      vec: normalizeIdlType(type.vec),
    };
  }
  if (type?.option !== undefined) {
    return {
      option: normalizeIdlType(type.option),
    };
  }
  if (type?.array !== undefined) {
    return {
      array: [normalizeIdlType(type.array[0]), type.array[1]],
    };
  }
  if (type?.fields) {
    return {
      ...type,
      fields: normalizeFields(type.fields),
    };
  }
  if (type?.variants) {
    return {
      ...type,
      variants: type.variants.map((variant: any) => ({
        ...variant,
        fields: Array.isArray(variant.fields) ? normalizeFields(variant.fields) : variant.fields,
      })),
    };
  }
  return type;
}
