const query = `query AlarmRuleList($limit: Int64, $offset: Int64, $filter: AstNode) {
  alarm_rule_list(limit: $limit, offset: $offset, filter: $filter) {
    count
    relation_entitys {
      key {
        id
      }
      meta {
        email {
          switch
        }
        level
        name
        sms {
          switch
        }
        status
        syslog {
          switch
        }
        staff {
          meta {
            real_name
          }
        }
        alarm_schema {
          value {
            project {
              name
            }
          }
        }
      }
    }
  }
}`;
const list = 'alarm_rule_list.relation_entitys';
const dict = {
  alarm_rule_name: 'alarm_rule_list.relation_entitys.meta.name',
  alarm_rule_schema_name: 'alarm_rule_list.relation_entitys.meta.alarm_schema.value.project.name',
  alarm_rule_level: 'alarm_rule_list.relation_entitys.meta.level',
  staff_real_name: 'alarm_rule_list.relation_entitys.meta.staff.meta.real_name',
  alarm_rule_status: 'alarm_rule_list.relation_entitys.meta.status',
  alarm_rule_id: 'alarm_rule_list.relation_entitys.key.id',
  total: 'alarm_rule_list.count',
  alarm_rule_email_switch: 'alarm_rule_list.relation_entitys.meta.email.switch',
  alarm_rule_syslog_switch: 'alarm_rule_list.relation_entitys.meta.syslog.switch',
  alarm_rule_sms_switch: 'alarm_rule_list.relation_entitys.meta.sms.switch',
};
module.exports = { query, list, dict };
