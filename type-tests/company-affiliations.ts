import type { OAuthIdentity, UserInfoData } from "../src/index.js";

export function companyYears(identity: OAuthIdentity, userInfo: UserInfoData): Array<number | null | undefined> {
  return [
    identity.company_affiliations?.[0]?.founding_year,
    userInfo.company_affiliations?.[0]?.founding_year,
  ];
}
