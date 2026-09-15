export function reusablePostingFields(row) {
  const fields = { deadline: '' }
  for (const [key, source] of Object.entries({ title: 'title', department: 'department', employmentType: 'employment_type',
    location: 'location', description: 'description', wageType: 'wage_type', wageMin: 'wage_min', wageMax: 'wage_max',
    workHoursStart: 'work_hours_start', workHoursEnd: 'work_hours_end', workDays: 'work_days' })) {
    fields[key] = String(row[source] ?? '')
  }
  return fields
}
