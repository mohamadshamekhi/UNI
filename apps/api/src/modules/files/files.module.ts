import { Module } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageService } from './storage.service.js';

@Module({
  imports: [IdentityModule, AclModule],
  providers: [StorageService, FilesService],
  controllers: [FilesController],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
