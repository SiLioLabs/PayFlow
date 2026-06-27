import { xdr, Address } from "@stellar/stellar-sdk";

export class ScValDecodeError extends Error {
  expectedType: string;
  actualType: string;

  constructor(expectedType: string, actualType: string) {
    super(`Expected ScVal type ${expectedType}, but got ${actualType}`);
    this.name = "ScValDecodeError";
    this.expectedType = expectedType;
    this.actualType = actualType;
  }
}

export namespace ScValDecoder {
  export function decodeI128(val: xdr.ScVal): bigint {
    const actualType = val.switch().name;
    if (actualType !== "scvI128") {
      throw new ScValDecodeError("scvI128", actualType);
    }
    return BigInt(val.i128().toString());
  }

  export function decodeU64(val: xdr.ScVal): bigint {
    const actualType = val.switch().name;
    if (actualType !== "scvU64") {
      throw new ScValDecodeError("scvU64", actualType);
    }
    return BigInt(val.u64().toString());
  }

  export function decodeBool(val: xdr.ScVal): boolean {
    const actualType = val.switch().name;
    if (actualType !== "scvBool") {
      throw new ScValDecodeError("scvBool", actualType);
    }
    return val.b();
  }

  export function decodeAddress(val: xdr.ScVal): string {
    const actualType = val.switch().name;
    if (actualType !== "scvAddress") {
      throw new ScValDecodeError("scvAddress", actualType);
    }
    return Address.fromScVal(val).toString();
  }

  export function decodeString(val: xdr.ScVal): string {
    const actualType = val.switch().name;
    if (actualType !== "scvString") {
      throw new ScValDecodeError("scvString", actualType);
    }
    return val.str().toString();
  }

  export function decodeSymbol(val: xdr.ScVal): string {
    const actualType = val.switch().name;
    if (actualType !== "scvSymbol") {
      throw new ScValDecodeError("scvSymbol", actualType);
    }
    return val.sym().toString();
  }

  export function decodeOption<T>(val: xdr.ScVal, inner: (v: xdr.ScVal) => T): T | null {
    const actualType = val.switch().name;
    if (actualType === "scvVoid") {
      return null;
    }
    return inner(val);
  }

  export function decodeVec<T>(val: xdr.ScVal, itemDecoder: (v: xdr.ScVal) => T): T[] {
    const actualType = val.switch().name;
    if (actualType !== "scvVec") {
      throw new ScValDecodeError("scvVec", actualType);
    }

    let vecItems: any[];
    if (typeof (val as any).vec === "function") {
      vecItems = (val as any).vec();
    } else {
      vecItems = (val as any)._value?.vec ?? [];
    }

    if (!Array.isArray(vecItems)) {
      return [];
    }

    return vecItems.map((item) => itemDecoder(item));
  }

  export function decodeStruct<T extends Record<string, any>>(
    val: xdr.ScVal,
    schema: { [K in keyof T]: (v: xdr.ScVal) => T[K] }
  ): T {
    const actualType = val.switch().name;
    if (actualType !== "scvMap") {
      throw new ScValDecodeError("scvMap", actualType);
    }

    const result: Partial<T> = {};

    const entries = val.map() ?? [];
    for (const entry of entries) {
      const key = decodeSymbol(entry.key());
      const decoder = schema[key as keyof T];
      if (decoder) {
        result[key as keyof T] = decoder(entry.val());
      }
    }

    return result as T;
  }
}
