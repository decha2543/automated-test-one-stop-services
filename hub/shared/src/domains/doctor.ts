export type DoctorCategory = 'required-install' | 'optional-install' | 'optional-process';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  version?: string;
  hint?: string;
  category: DoctorCategory;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  overallOk: boolean;
  credentialsOk: boolean;
}
