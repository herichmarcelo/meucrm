/**
 * Tipos para configuração e cálculo de expediente comercial (Business Hours).
 */

export interface BusinessHourSlot {
  id?: string;
  organization_id?: string;
  day_of_week: number; // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  open_time: string; // "HH:mm" ou "HH:mm:ss"
  close_time: string; // "HH:mm" ou "HH:mm:ss"
  is_active: boolean;
  timezone?: string;
}

export interface BusinessHoliday {
  id?: string;
  organization_id?: string;
  holiday_date: string; // "YYYY-MM-DD"
  description?: string | null;
}

export interface BusinessHoursConfig {
  slots: BusinessHourSlot[];
  holidays: BusinessHoliday[];
  timezone: string;
}
