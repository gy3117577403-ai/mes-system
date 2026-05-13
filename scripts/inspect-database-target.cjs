function mask(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text.slice(0, 1)}***${text.slice(-1)}`;
}

function inspectDatabaseTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.trim()) {
    return {
      ok: false,
      hasDatabaseUrl: false,
      protocol: '',
      host: '',
      port: '',
      database: '',
      username: '',
      isLocalhost: false,
      looksRemote: false,
      looksProduction: false,
      safeForLocalSchemaDeploy: false,
      warnings: ['DATABASE_URL is not configured'],
    };
  }

  try {
    const url = new URL(raw);
    const host = url.hostname;
    const database = url.pathname.replace(/^\//, '');
    const username = url.username;
    const haystack = `${host} ${database}`.toLowerCase();
    const remotePattern = /(sealos|railway|render|supabase|neon|aws|rds|aliyun|tencent|cloud|postgres\.database|pg)/i;
    const prodPattern = /(prod|production|mes-prod|online)/i;
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host);
    const looksRemote = remotePattern.test(haystack);
    const looksProduction = prodPattern.test(haystack);
    const warnings = [];
    if (looksRemote) warnings.push('DATABASE_URL host/database looks remote.');
    if (looksProduction) warnings.push('DATABASE_URL host/database looks production-like.');
    if (!isLocalhost) warnings.push('DATABASE_URL is not localhost.');

    return {
      ok: true,
      hasDatabaseUrl: true,
      protocol: url.protocol,
      host,
      port: url.port || '',
      database,
      username: mask(username),
      isLocalhost,
      looksRemote,
      looksProduction,
      safeForLocalSchemaDeploy: isLocalhost && !looksRemote && !looksProduction,
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      hasDatabaseUrl: true,
      protocol: '',
      host: '',
      port: '',
      database: '',
      username: '',
      isLocalhost: false,
      looksRemote: false,
      looksProduction: false,
      safeForLocalSchemaDeploy: false,
      warnings: [`DATABASE_URL parse failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

if (require.main === module) {
  console.log(JSON.stringify(inspectDatabaseTarget(), null, 2));
}

module.exports = { inspectDatabaseTarget };
