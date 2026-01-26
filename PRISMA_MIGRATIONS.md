# Prisma Migrations Guide

This guide explains how to create, apply, and rollback database migrations using Prisma in your lyrian-stripe project.

## Creating a Migration

1. Update your `prisma/schema.prisma` file with the desired changes.
2. Run the following command to create and apply a migration:

   ```sh
   npx prisma migrate dev --name <migration_name>
   ```

   Replace `<migration_name>` with a descriptive name for your migration.

## Applying Pending Migrations

If you have migrations that have not yet been applied to your database, run:

```sh
npx prisma migrate deploy
```

## Rolling Back a Migration

Prisma does not support automatic rollback of migrations. To revert changes:

1. Manually edit your `schema.prisma` to the previous state.
2. Create a new migration to undo the changes:

   ```sh
   npx prisma migrate dev --name revert_<migration_name>
   ```

3. Alternatively, you can reset your database (for development only):

   ```sh
   npx prisma migrate reset
   ```

   This will drop all data and reapply all migrations from scratch.

## Viewing Migration Status

To check the status of your migrations:

```sh
npx prisma migrate status
```

## Additional Resources

- [Prisma Migrate Docs](https://www.prisma.io/docs/orm/prisma-migrate)

---

**Note:** Always backup your production database before applying or reverting migrations.
