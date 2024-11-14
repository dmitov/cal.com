"use client";

import { parseAsArrayOf, parseAsJson, useQueryStates } from "nuqs";
import { z } from "zod";

import type { SelectFilterValue, TextFilterValue, FilterValue } from "./types";
import { ZSelectFilterValue, ZTextFilterValue } from "./types";

const filterSchema = z.object({
  f: z.string(),
  v: z.union([ZSelectFilterValue, ZTextFilterValue]),
});

export const filtersSearchParams = {
  activeFilters: parseAsArrayOf(parseAsJson(filterSchema.parse)).withDefault([]),
};

export function useFiltersSearchState() {
  return useQueryStates(filtersSearchParams);
}

export type FiltersSearchState = ReturnType<typeof useFiltersSearchState>[0];
export type SetFiltersSearchState = ReturnType<typeof useFiltersSearchState>[1];
export type ActiveFilter = NonNullable<FiltersSearchState["activeFilters"]>[number];

export const textFilter = (cellValue: string, filterValue: TextFilterValue) => {
  switch (filterValue.data.operator) {
    case "equals":
      return cellValue.toLowerCase() === (filterValue.data.operand || "").toLowerCase();
    case "notEquals":
      return cellValue.toLowerCase() !== (filterValue.data.operand || "").toLowerCase();
    case "contains":
      return cellValue.toLowerCase().includes((filterValue.data.operand || "").toLowerCase());
    case "notContains":
      return !cellValue.toLowerCase().includes((filterValue.data.operand || "").toLowerCase());
    case "startsWith":
      return cellValue.toLowerCase().startsWith((filterValue.data.operand || "").toLowerCase());
    case "endsWith":
      return cellValue.toLowerCase().endsWith((filterValue.data.operand || "").toLowerCase());
    case "isEmpty":
      return cellValue.trim() === "";
    case "isNotEmpty":
      return cellValue.trim() !== "";
    default:
      return false;
  }
};

export const isTextFilterValue = (filterValue: unknown): filterValue is TextFilterValue => {
  return (
    typeof filterValue === "object" &&
    filterValue !== null &&
    "type" in filterValue &&
    filterValue.type === "text"
  );
};

export const isSelectFilterValue = (filterValue: unknown): filterValue is SelectFilterValue => {
  return Array.isArray(filterValue) && filterValue.every((item) => typeof item === "string");
};

export function makeWhereClause(columnName: string, filterValue: FilterValue) {
  if (isSelectFilterValue(filterValue)) {
    return {
      [columnName]: {
        in: filterValue,
      },
    };
  } else if (isTextFilterValue(filterValue)) {
    const { operator, operand } = filterValue.data;

    switch (operator) {
      case "equals":
        return {
          [columnName]: {
            equals: operand,
          },
        };
      case "notEquals":
        return {
          [columnName]: {
            not: operand,
          },
        };
      case "contains":
        return {
          [columnName]: {
            contains: operand,
          },
        };
      case "notContains":
        return {
          NOT: {
            [columnName]: {
              contains: operand,
            },
          },
        };
      case "startsWith":
        return {
          [columnName]: {
            startsWith: operand,
          },
        };
      case "endsWith":
        return {
          [columnName]: {
            endsWith: operand,
          },
        };
      case "isEmpty":
        return {
          [columnName]: {
            equals: "",
          },
        };
      case "isNotEmpty":
        return {
          NOT: {
            [columnName]: {
              equals: "",
            },
          },
        };
    }
  }
  return {};
}
