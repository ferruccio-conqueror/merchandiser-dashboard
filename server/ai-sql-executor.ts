/**
 * Safe SQL Execution for AI Analyst
 * Provides read-only SQL query execution with validation, limits, and timeouts
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

const MAX_ROWS = 500;
const QUERY_TIMEOUT_MS = 30000;

// Keywords that indicate write/destructive operations
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE',
  'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'EXEC', 'EXECUTE', 'CALL',
  'SET ', 'RESET', 'COPY', 'VACUUM', 'ANALYZE', 'REINDEX',
  'LOCK', 'UNLOCK', 'LISTEN', 'NOTIFY', 'PREPARE', 'DEALLOCATE'
];

// Patterns that could be used to sneak write operations or cause harm
const FORBIDDEN_PATTERNS = [
  /;\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)/gi,  // Multi-statement writes
  /--/g,                                                        // SQL comments (can hide attacks)
  /\/\*/g,                                                      // Block comment start
  /\*\//g,                                                      // Block comment end
  /\bSELECT\b[^;]*\bINTO\b/gi,                                  // SELECT INTO (creates tables)
  /\bCREATE\s+TABLE\s+.*\s+AS\b/gi,                             // CREATE TABLE AS SELECT
  /\bINTO\s+OUTFILE\b/gi,                                       // MySQL-style file write
  /\bINTO\s+DUMPFILE\b/gi,                                      // MySQL-style file write
  /\bCOPY\s+.*\s+TO\b/gi,                                       // PostgreSQL COPY TO
  /\bCOPY\s+.*\s+FROM\b/gi,                                     // PostgreSQL COPY FROM
  /\bpg_read_file\b/gi,                                         // PostgreSQL file read function
  /\bpg_write_file\b/gi,                                        // PostgreSQL file write function
  /\bpg_sleep\b/gi,                                             // Denial of service
  /\bLO_IMPORT\b/gi,                                            // Large object import
  /\bLO_EXPORT\b/gi,                                            // Large object export
];

export interface SQLExecutionResult {
  success: boolean;
  data?: any[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  executionTimeMs?: number;
}

function validateQuery(query: string): { valid: boolean; error?: string } {
  const upperQuery = query.toUpperCase().trim();
  
  if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH')) {
    return { valid: false, error: "Only SELECT and WITH (CTE) queries are allowed. Queries must be read-only." };
  }
  
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    const selectPattern = new RegExp(`SELECT.*\\b${keyword}\\b`, 'i');
    
    if (pattern.test(upperQuery) && !selectPattern.test(upperQuery)) {
      if (keyword === 'SET ' && upperQuery.includes('SET TRANSACTION')) continue;
      return { valid: false, error: `Query contains forbidden keyword: ${keyword}. Only read operations are allowed.` };
    }
  }
  
  for (const pattern of FORBIDDEN_PATTERNS) {
    // Reset regex lastIndex since we're reusing patterns
    pattern.lastIndex = 0;
    if (pattern.test(query)) {
      return { valid: false, error: "Query contains forbidden patterns (SELECT INTO, file operations, comments, or multiple statements). Only simple SELECT queries are allowed." };
    }
  }
  
  const semicolonCount = (query.match(/;/g) || []).length;
  if (semicolonCount > 1) {
    return { valid: false, error: "Multiple statements are not allowed. Please send one query at a time." };
  }
  
  return { valid: true };
}

function sanitizeQuery(query: string): string {
  let sanitized = query.trim();
  
  if (sanitized.endsWith(';')) {
    sanitized = sanitized.slice(0, -1).trim();
  }
  
  if (!sanitized.toUpperCase().includes('LIMIT')) {
    sanitized = `SELECT * FROM (${sanitized}) AS limited_query LIMIT ${MAX_ROWS + 1}`;
  }
  
  return sanitized;
}

export async function executeSafeQuery(query: string): Promise<SQLExecutionResult> {
  const startTime = Date.now();
  
  const validation = validateQuery(query);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const sanitizedQuery = sanitizeQuery(query);
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Query timed out after ${QUERY_TIMEOUT_MS}ms`)), QUERY_TIMEOUT_MS);
    });
    
    const queryPromise = db.execute(sql.raw(sanitizedQuery));
    
    const result = await Promise.race([queryPromise, timeoutPromise]);
    const executionTimeMs = Date.now() - startTime;
    
    const rows = result.rows as any[];
    const truncated = rows.length > MAX_ROWS;
    const data = truncated ? rows.slice(0, MAX_ROWS) : rows;
    
    return {
      success: true,
      data,
      rowCount: data.length,
      truncated,
      executionTimeMs
    };
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    
    let errorMessage = error.message || "Unknown database error";
    
    if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
      const tableMatch = errorMessage.match(/relation "([^"]+)" does not exist/);
      if (tableMatch) {
        errorMessage = `Table "${tableMatch[1]}" does not exist. Check the schema documentation for correct table names.`;
      }
    } else if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
      const colMatch = errorMessage.match(/column "([^"]+)" does not exist/);
      if (colMatch) {
        errorMessage = `Column "${colMatch[1]}" does not exist. Check the schema documentation for correct column names.`;
      }
    } else if (errorMessage.includes('syntax error')) {
      errorMessage = `SQL syntax error: ${errorMessage}`;
    }
    
    return {
      success: false,
      error: errorMessage,
      executionTimeMs
    };
  }
}

export function formatQueryResults(result: SQLExecutionResult): string {
  if (!result.success) {
    return `Query Error: ${result.error}`;
  }
  
  if (!result.data || result.data.length === 0) {
    return "Query returned no results.";
  }
  
  const rows = result.data;
  const columns = Object.keys(rows[0]);
  
  let output = `Query Results (${result.rowCount} rows${result.truncated ? `, truncated from more than ${MAX_ROWS}` : ''}):\n\n`;
  
  if (rows.length <= 20) {
    output += `| ${columns.join(' | ')} |\n`;
    output += `| ${columns.map(() => '---').join(' | ')} |\n`;
    
    for (const row of rows) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null) return 'NULL';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });
      output += `| ${values.join(' | ')} |\n`;
    }
  } else {
    output += JSON.stringify(rows, null, 2);
  }
  
  output += `\n(Execution time: ${result.executionTimeMs}ms)`;
  
  return output;
}
